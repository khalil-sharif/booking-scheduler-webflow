/**
 * booking-widget.js — embeddable booking calendar.
 *
 *   <div id="booking-widget"></div>
 *   <script src="https://<app-host>/widget/booking-widget.js" data-site="PUBLIC_KEY"
 *           data-api-base="https://<app-host>"></script>
 *
 * Slots are computed server-side in the site's timezone; this widget renders them in the
 * visitor's local timezone via Intl.DateTimeFormat.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var KEY = script.getAttribute("data-site");
  var API = script.getAttribute("data-api-base") || "";
  var mount = document.getElementById("booking-widget") || (function () {
    var d = document.createElement("div");
    script.parentNode.insertBefore(d, script);
    return d;
  })();

  var state = { services: [], service: null, month: new Date(), date: null, slots: [], slot: null, loading: false, error: "", done: null };
  var timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  var dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

  function api(path, opts) {
    return fetch(API + "/api" + path, opts).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) { var e = new Error(b.error || "Request failed"); e.status = r.status; throw e; }
        return b;
      });
    });
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function loadSlots() {
    if (!state.service || !state.date) return;
    state.loading = true; state.slot = null; render();
    api("/availability?key=" + encodeURIComponent(KEY) + "&service=" + state.service.id + "&date=" + state.date)
      .then(function (d) { state.slots = d.slots; })
      .catch(function (e) { state.error = e.message; })
      .then(function () { state.loading = false; render(); });
  }

  function submit(form) {
    var payload = {
      key: KEY, serviceId: state.service.id, startUtc: state.slot.startUtc,
      name: form.name.value, email: form.email.value, notes: form.notes.value,
    };
    if (!payload.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      state.error = "Please enter your name and a valid email."; render(); return;
    }
    // Optimistic UI: show confirmation immediately, roll back on conflict.
    var previous = { slot: state.slot, done: state.done };
    state.done = { optimistic: true, slot: state.slot }; state.error = ""; render();
    api("/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (b) { state.done = { slot: previous.slot, id: b.id }; render(); })
      .catch(function (e) {
        state.done = null; state.slot = null;
        state.error = e.status === 409 ? "Sorry, that slot was just taken. Please choose another time." : e.message;
        loadSlots();
      });
  }

  function renderCalendar() {
    var first = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
    var days = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0).getDate();
    var today = ymd(new Date());
    var head = el("div", { class: "bw-cal-head" }, [
      el("button", { type: "button", text: "‹", onclick: function () { state.month = new Date(first.getFullYear(), first.getMonth() - 1, 1); render(); } }),
      el("strong", { text: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }),
      el("button", { type: "button", text: "›", onclick: function () { state.month = new Date(first.getFullYear(), first.getMonth() + 1, 1); render(); } }),
    ]);
    var grid = el("div", { class: "bw-cal-grid" });
    for (var i = 0; i < first.getDay(); i++) grid.appendChild(el("span"));
    for (var d = 1; d <= days; d++) {
      (function (day) {
        var date = first.getFullYear() + "-" + pad(first.getMonth() + 1) + "-" + pad(day);
        var past = date < today;
        grid.appendChild(el("button", {
          type: "button", text: String(day), disabled: past ? "disabled" : null,
          class: "bw-day" + (state.date === date ? " active" : ""),
          onclick: function () { state.date = date; loadSlots(); },
        }));
      })(d);
    }
    return el("div", {}, [head, grid]);
  }

  function renderForm() {
    var form = el("form", { class: "bw-form" }, [
      el("input", { name: "name", placeholder: "Your name", required: "required" }),
      el("input", { name: "email", type: "email", placeholder: "Email", required: "required" }),
      el("textarea", { name: "notes", placeholder: "Notes (optional)" }),
      el("button", { type: "submit", text: "Confirm booking" }),
    ]);
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(form); });
    return form;
  }

  function render() {
    mount.innerHTML = "";
    var root = el("div", { class: "bw-root" });

    if (state.done) {
      root.appendChild(el("h3", { text: state.done.optimistic ? "Booking…" : "You're booked!" }));
      root.appendChild(el("p", { text: state.service.name + " — " + dayFmt.format(new Date(state.done.slot.startUtc)) + " at " + timeFmt.format(new Date(state.done.slot.startUtc)) }));
      if (!state.done.optimistic) root.appendChild(el("p", { text: "A confirmation email is on its way." }));
      mount.appendChild(root); return;
    }

    if (state.error) root.appendChild(el("p", { class: "bw-error", text: state.error }));

    var select = el("select", { onchange: function (e) {
      state.service = state.services.find(function (s) { return s.id === e.target.value; }) || null;
      state.date = null; state.slots = []; state.slot = null; render();
    } }, [el("option", { value: "", text: "Select a service" })].concat(state.services.map(function (s) {
      return el("option", { value: s.id, text: s.name + " (" + s.duration_minutes + " min)", selected: state.service && state.service.id === s.id ? "selected" : null });
    })));
    root.appendChild(select);

    if (state.service) {
      root.appendChild(renderCalendar());
      if (state.date) {
        root.appendChild(el("h4", { text: state.date }));
        if (state.loading) root.appendChild(el("p", { text: "Loading times…" }));
        else if (!state.slots.length) root.appendChild(el("p", { text: "No times available on this day." }));
        else root.appendChild(el("div", { class: "bw-slots" }, state.slots.map(function (s) {
          return el("button", { type: "button", class: "bw-slot" + (state.slot === s ? " active" : ""), text: timeFmt.format(new Date(s.startUtc)),
            onclick: function () { state.slot = s; render(); } });
        })));
      }
      if (state.slot) root.appendChild(renderForm());
    }
    mount.appendChild(root);
  }

  var style = document.createElement("style");
  style.textContent =
    ".bw-root{font-family:system-ui,sans-serif;max-width:420px}.bw-root select,.bw-form input,.bw-form textarea{width:100%;padding:8px;margin:6px 0;border:1px solid #d5d5de;border-radius:6px;box-sizing:border-box}" +
    ".bw-cal-head{display:flex;justify-content:space-between;align-items:center;margin:12px 0}.bw-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}" +
    ".bw-day,.bw-slot{padding:8px;border:1px solid #d5d5de;background:#fff;border-radius:6px;cursor:pointer}.bw-day:disabled{opacity:.35;cursor:not-allowed}" +
    ".bw-day.active,.bw-slot.active{background:#4353ff;color:#fff;border-color:#4353ff}.bw-slots{display:flex;flex-wrap:wrap;gap:6px}.bw-error{color:#d6403f}" +
    ".bw-form button{padding:10px 14px;background:#4353ff;color:#fff;border:0;border-radius:6px;cursor:pointer}";
  document.head.appendChild(style);

  api("/public/services?key=" + encodeURIComponent(KEY))
    .then(function (d) { state.services = d.services; render(); })
    .catch(function (e) { state.error = e.message; render(); });
})();
