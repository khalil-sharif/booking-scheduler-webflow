import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../db";
import { webflowClient } from "../services/webflow-client";
import { computeAvailableSlots } from "../services/scheduler";

const router = Router();

/** Resolves site from the public key embedded in the widget snippet. */
function siteFromKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  const row = db
    .prepare(`SELECT site_id FROM installations WHERE public_key = ? AND uninstalled_at IS NULL`)
    .get(key) as { site_id: string } | undefined;
  return row?.site_id ?? null;
}

// ---- Public (widget) endpoints ---------------------------------------------------------------

router.get("/public/services", (req, res) => {
  const siteId = siteFromKey(req.query.key);
  if (!siteId) return void res.status(401).json({ error: "Invalid key" });
  const services = db
    .prepare(`SELECT id, name, duration_minutes, price, description FROM services WHERE site_id = ? AND active = 1`)
    .all(siteId);
  const tz = (db.prepare(`SELECT timezone FROM installations WHERE site_id = ?`).get(siteId) as { timezone: string }).timezone;
  res.json({ services, timezone: tz });
});

router.get("/availability", (req, res) => {
  const siteId = siteFromKey(req.query.key);
  if (!siteId) return void res.status(401).json({ error: "Invalid key" });
  const { service, date } = req.query as { service?: string; date?: string };
  if (!service || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return void res.status(400).json({ error: "service and date (YYYY-MM-DD) are required" });
  }
  res.json({ slots: computeAvailableSlots(siteId, service, date) });
});

// ---- Admin (App Panel) endpoints ---------------------------------------------------------------

router.get("/sites/:siteId/config", (req, res) => {
  const site = db.prepare(`SELECT timezone, public_key FROM installations WHERE site_id = ?`).get(req.params.siteId);
  const services = db.prepare(`SELECT * FROM services WHERE site_id = ?`).all(req.params.siteId);
  const rules = db.prepare(`SELECT * FROM availability_rules WHERE site_id = ? ORDER BY day_of_week, start_time`).all(req.params.siteId);
  const blackouts = db.prepare(`SELECT * FROM blackout_dates WHERE site_id = ? ORDER BY date`).all(req.params.siteId);
  res.json({ site, services, rules, blackouts });
});

router.post("/sites/:siteId/services", async (req, res) => {
  const { name, durationMinutes, price, description } = req.body as {
    name: string;
    durationMinutes: number;
    price?: number;
    description?: string;
  };
  if (!name || !durationMinutes) return void res.status(400).json({ error: "name and durationMinutes are required" });

  const id = uuid();
  let cmsItemId: string | null = null;
  try {
    const inst = db.prepare(`SELECT services_collection_id FROM installations WHERE site_id = ?`).get(req.params.siteId) as {
      services_collection_id: string | null;
    };
    if (inst.services_collection_id) {
      const item = await webflowClient.createItem(req.params.siteId, inst.services_collection_id, {
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        "duration-minutes": durationMinutes,
        price: price ?? 0,
        description: description ?? "",
      });
      cmsItemId = item.id;
    }
  } catch {
    // CMS mirror is best-effort; the local record remains the source of truth for availability.
  }

  db.prepare(
    `INSERT INTO services (id, site_id, name, duration_minutes, price, description, cms_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.params.siteId, name, durationMinutes, price ?? 0, description ?? "", cmsItemId);
  res.status(201).json({ id });
});

router.put("/sites/:siteId/rules", (req, res) => {
  const rules = req.body.rules as Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
  const replace = db.transaction(() => {
    db.prepare(`DELETE FROM availability_rules WHERE site_id = ?`).run(req.params.siteId);
    const stmt = db.prepare(
      `INSERT INTO availability_rules (id, site_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)`
    );
    rules.forEach((r) => stmt.run(uuid(), req.params.siteId, r.dayOfWeek, r.startTime, r.endTime));
  });
  replace();
  res.json({ ok: true });
});

router.post("/sites/:siteId/blackouts", (req, res) => {
  const { date, reason } = req.body as { date: string; reason?: string };
  db.prepare(`INSERT OR REPLACE INTO blackout_dates (id, site_id, date, reason) VALUES (?, ?, ?, ?)`).run(
    uuid(),
    req.params.siteId,
    date,
    reason ?? null
  );
  res.status(201).json({ ok: true });
});

router.delete("/sites/:siteId/blackouts/:date", (req, res) => {
  db.prepare(`DELETE FROM blackout_dates WHERE site_id = ? AND date = ?`).run(req.params.siteId, req.params.date);
  res.json({ ok: true });
});

router.get("/sites/:siteId/bookings", (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, s.name AS service_name FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.site_id = ? ORDER BY b.start_utc DESC LIMIT 200`
    )
    .all(req.params.siteId);
  res.json({ bookings: rows });
});

export default router;
