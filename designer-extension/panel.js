/**
 * App Panel controller for booking-scheduler-webflow (Designer Extension iframe).
 * Site identity: ?site= from the OAuth callback, or webflow.getSiteInfo() in the Designer.
 */
(function () {
  "use strict";

  var API_BASE = window.location.origin.replace(/\/designer-extension.*/, "");
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var state = { siteId: null, config: null, rules: [] };

  function api(path, options) {
    return fetch(API_BASE + "/api" + path, Object.assign({ headers: { "Content-Type": "application/json" } }, options)).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error(b.error || r.statusText);
        return b;
      });
    });
  }

  function resolveSiteId() {
    var q = new URL(window.location.href).searchParams.get("site");
    if (q) return Promise.resolve(q);
    if (window.webflow && window.webflow.getSiteInfo) return window.webflow.getSiteInfo().then(function (i) { return i.siteId; });
    return Promise.resolve(null);
  }

  function load() {
    return api("/sites/" + state.siteId + "/config").then(function (cfg) {
      state.config = cfg;
      state.rules = cfg.rules.map(function (r) { return { dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time }; });
      renderServices(); renderRules(); renderBlackouts(); renderSnippet();
      return api("/sites/" + state.siteId + "/bookings").then(renderBookings);
    });
  }

  function renderServices() {
    var ul = document.getElementById("services-list");
    ul.innerHTML = "";
    state.config.services.forEach(function (s) {
      var li = document.createElement("li");
      li.textContent = s.name + " — " + s.duration_minutes + " min" + (s.price ? " · $" + s.price : "");
      ul.appendChild(li);
    });
  }

  document.getElementById("add-service").addEventListener("click", function () {
    var name = document.getElementById("svc-name").value.trim();
    var duration = Number(document.getElementById("svc-duration").value);
    if (!name || !duration) return alert("Name and duration are required.");
    api("/sites/" + state.siteId + "/services", {
      method: "POST",
      body: JSON.stringify({ name: name, durationMinutes: duration, price: Number(document.getElementById("svc-price").value) || 0 }),
    }).then(load).catch(function (e) { alert(e.message); });
  });

  // Availability editor: one start/end pair per weekday (empty = closed).
  function ruleFor(day) {
    return state.rules.find(function (r) { return r.dayOfWeek === day; });
  }

  function renderRules() {
    var table = document.getElementById("rules-grid");
    table.innerHTML = "";
    DAYS.forEach(function (label, day) {
      var rule = ruleFor(day);
      var tr = document.createElement("tr");
      var tdLabel = document.createElement("td");
      tdLabel.textContent = label;
      var tdStart = document.createElement("td");
      var tdEnd = document.createElement("td");
      var start = document.createElement("input");
      start.type = "time"; start.value = rule ? rule.startTime : "";
      var end = document.createElement("input");
      end.type = "time"; end.value = rule ? rule.endTime : "";
      function sync() {
        state.rules = state.rules.filter(function (r) { return r.dayOfWeek !== day; });
        if (start.value && end.value) state.rules.push({ dayOfWeek: day, startTime: start.value, endTime: end.value });
      }
      start.addEventListener("change", sync);
      end.addEventListener("change", sync);
      tdStart.appendChild(start); tdEnd.appendChild(end);
      tr.appendChild(tdLabel); tr.appendChild(tdStart); tr.appendChild(tdEnd);
      table.appendChild(tr);
    });
  }

  document.getElementById("save-rules").addEventListener("click", function () {
    api("/sites/" + state.siteId + "/rules", { method: "PUT", body: JSON.stringify({ rules: state.rules }) })
      .then(function () { alert("Availability saved."); }).catch(function (e) { alert(e.message); });
  });

  function renderBlackouts() {
    var ul = document.getElementById("blackouts-list");
    ul.innerHTML = "";
    state.config.blackouts.forEach(function (b) {
      var li = document.createElement("li");
      li.textContent = b.date + (b.reason ? " — " + b.reason : "");
      var rm = document.createElement("button");
      rm.className = "btn"; rm.textContent = "Remove";
      rm.addEventListener("click", function () {
        api("/sites/" + state.siteId + "/blackouts/" + b.date, { method: "DELETE" }).then(load);
      });
      li.appendChild(rm);
      ul.appendChild(li);
    });
  }

  document.getElementById("add-blackout").addEventListener("click", function () {
    var date = document.getElementById("blackout-date").value;
    if (!date) return;
    api("/sites/" + state.siteId + "/blackouts", {
      method: "POST",
      body: JSON.stringify({ date: date, reason: document.getElementById("blackout-reason").value }),
    }).then(load);
  });

  function snippet() {
    return '<div id="booking-widget"></div>\n<script src="' + API_BASE + '/widget/booking-widget.js" data-site="' +
      state.config.site.public_key + '" data-api-base="' + API_BASE + '"><' + "/script>";
  }

  function renderSnippet() {
    document.getElementById("embed-snippet").textContent = snippet();
  }

  document.getElementById("copy-snippet").addEventListener("click", function () {
    if (navigator.clipboard) navigator.clipboard.writeText(snippet());
  });

  // Inserts a custom Embed element on the selected page via the Designer API when available.
  document.getElementById("insert-embed").addEventListener("click", function () {
    if (!window.webflow || !window.webflow.getSelectedElement) return alert("Open this panel inside the Designer to insert directly, or copy the snippet.");
    window.webflow.getSelectedElement().then(function (el) {
      if (!el || !el.children || !el.append) return alert("Select a container element first.");
      return el.append(window.webflow.elementPresets.DOM).then(function (dom) {
        return dom.setTag("div").then(function () {
          return dom.setCustomAttribute("data-booking-embed", "true");
        });
      });
    }).catch(function (e) { alert(e.message); });
  });

  function renderBookings(data) {
    var body = document.getElementById("bookings-body");
    body.innerHTML = "";
    (data.bookings || []).forEach(function (b) {
      var tr = document.createElement("tr");
      [new Date(b.start_utc).toLocaleString(), b.service_name, b.customer_name, b.status].forEach(function (v) {
        var td = document.createElement("td");
        td.textContent = v;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  resolveSiteId().then(function (siteId) {
    state.siteId = siteId;
    if (siteId) load();
  });
})();
