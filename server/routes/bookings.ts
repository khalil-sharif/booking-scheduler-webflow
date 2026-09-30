import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../db";
import { webflowClient } from "../services/webflow-client";
import { isSlotFree, withSlotLock } from "../services/scheduler";
import { newManageToken, verifyManageToken } from "../services/signing";
import { buildIcs, confirmationHtml, sendMail } from "../services/mailer";

const router = Router();
const APP_BASE_URL = process.env.APP_PUBLIC_URL || "http://localhost:3000";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function mirrorToCms(siteId: string, bookingId: string): Promise<void> {
  try {
    const row = db
      .prepare(
        `SELECT b.*, s.name AS service_name, i.bookings_collection_id AS coll
         FROM bookings b JOIN services s ON s.id = b.service_id JOIN installations i ON i.site_id = b.site_id
         WHERE b.id = ?`
      )
      .get(bookingId) as
      | { customer_name: string; customer_email: string; service_name: string; start_utc: string; status: string; cms_item_id: string | null; coll: string | null }
      | undefined;
    if (!row?.coll) return;

    const fieldData = {
      name: `${row.customer_name} — ${row.service_name}`,
      slug: `booking-${bookingId.slice(0, 8)}`,
      "customer-email": row.customer_email,
      service: row.service_name,
      "start-time": row.start_utc,
      status: row.status,
    };

    if (row.cms_item_id) {
      await webflowClient.updateItem(siteId, row.coll, row.cms_item_id, fieldData);
    } else {
      const item = await webflowClient.createItem(siteId, row.coll, fieldData);
      db.prepare(`UPDATE bookings SET cms_item_id = ? WHERE id = ?`).run(item.id, bookingId);
    }
  } catch {
    // CMS mirror is best-effort; local DB remains authoritative.
  }
}

/** Create a booking. Re-checks availability inside a per-slot critical section (409 on conflict). */
router.post("/bookings", async (req, res) => {
  const { key, serviceId, startUtc, name, email, notes } = req.body as {
    key: string;
    serviceId: string;
    startUtc: string;
    name: string;
    email: string;
    notes?: string;
  };

  const inst = db.prepare(`SELECT site_id FROM installations WHERE public_key = ? AND uninstalled_at IS NULL`).get(key) as
    | { site_id: string }
    | undefined;
  if (!inst) return void res.status(401).json({ error: "Invalid key" });
  if (!name?.trim() || !EMAIL_RE.test(email ?? "") || !serviceId || Number.isNaN(Date.parse(startUtc))) {
    return void res.status(400).json({ error: "Valid name, email, serviceId and startUtc are required" });
  }

  const service = db
    .prepare(`SELECT name, duration_minutes FROM services WHERE id = ? AND site_id = ? AND active = 1`)
    .get(serviceId, inst.site_id) as { name: string; duration_minutes: number } | undefined;
  if (!service) return void res.status(404).json({ error: "Service not found" });

  try {
    const booking = await withSlotLock(`${inst.site_id}:${startUtc}`, () => {
      if (!isSlotFree(inst.site_id, serviceId, startUtc)) return null;
      const id = uuid();
      const token = newManageToken();
      const endUtc = new Date(Date.parse(startUtc) + service.duration_minutes * 60000).toISOString();
      db.prepare(
        `INSERT INTO bookings (id, site_id, service_id, customer_name, customer_email, notes, start_utc, end_utc, manage_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, inst.site_id, serviceId, name.trim(), email.trim(), notes ?? "", startUtc, endUtc, token);
      return { id, token, endUtc };
    });

    if (!booking) return void res.status(409).json({ error: "That time slot was just taken. Please pick another." });

    const manageUrl = `${APP_BASE_URL}/api/bookings/manage/${booking.token}`;
    await sendMail({
      to: email,
      subject: `Booking confirmed: ${service.name}`,
      html: confirmationHtml(name, service.name, startUtc, manageUrl),
      icsAttachment: buildIcs({ uid: booking.id, summary: service.name, startUtc, endUtc: booking.endUtc, description: notes }),
    });
    void mirrorToCms(inst.site_id, booking.id);

    res.status(201).json({ id: booking.id, manageToken: booking.token });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/bookings/manage/:token", (req, res) => {
  if (!verifyManageToken(req.params.token)) return void res.status(400).json({ error: "Invalid token" });
  const row = db
    .prepare(
      `SELECT b.id, b.start_utc, b.end_utc, b.status, s.name AS service_name, s.id AS service_id
       FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.manage_token = ?`
    )
    .get(req.params.token);
  if (!row) return void res.status(404).json({ error: "Booking not found" });
  res.json({ booking: row });
});

/** Reschedule via signed token: re-runs the availability check under the slot lock. */
router.patch("/bookings/manage/:token", async (req, res) => {
  if (!verifyManageToken(req.params.token)) return void res.status(400).json({ error: "Invalid token" });
  const { startUtc } = req.body as { startUtc: string };
  const booking = db
    .prepare(`SELECT id, site_id, service_id FROM bookings WHERE manage_token = ? AND status = 'confirmed'`)
    .get(req.params.token) as { id: string; site_id: string; service_id: string } | undefined;
  if (!booking) return void res.status(404).json({ error: "Booking not found" });
  if (Number.isNaN(Date.parse(startUtc))) return void res.status(400).json({ error: "Invalid startUtc" });

  const service = db.prepare(`SELECT duration_minutes FROM services WHERE id = ?`).get(booking.service_id) as {
    duration_minutes: number;
  };

  const ok = await withSlotLock(`${booking.site_id}:${startUtc}`, () => {
    if (!isSlotFree(booking.site_id, booking.service_id, startUtc, booking.id)) return false;
    const endUtc = new Date(Date.parse(startUtc) + service.duration_minutes * 60000).toISOString();
    db.prepare(`UPDATE bookings SET start_utc = ?, end_utc = ? WHERE id = ?`).run(startUtc, endUtc, booking.id);
    return true;
  });
  if (!ok) return void res.status(409).json({ error: "That time slot is not available." });

  void mirrorToCms(booking.site_id, booking.id);
  res.json({ ok: true });
});

router.delete("/bookings/manage/:token", (req, res) => {
  if (!verifyManageToken(req.params.token)) return void res.status(400).json({ error: "Invalid token" });
  const booking = db.prepare(`SELECT id, site_id FROM bookings WHERE manage_token = ?`).get(req.params.token) as
    | { id: string; site_id: string }
    | undefined;
  if (!booking) return void res.status(404).json({ error: "Booking not found" });
  db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(booking.id);
  void mirrorToCms(booking.site_id, booking.id);
  res.json({ ok: true });
});

export default router;
