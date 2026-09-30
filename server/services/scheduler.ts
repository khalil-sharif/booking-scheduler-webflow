import { db } from "../db";
import { Slot } from "../../shared/types";

const SLOT_STEP_MINUTES = 15;

/** Converts a wall-clock date+time in an IANA timezone to a UTC epoch (ms). */
export function zonedToUtcMs(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute)
  );
  return guess - (asLocal - guess);
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Computes open slots for a service on a date (YYYY-MM-DD, site timezone), server-side. */
export function computeAvailableSlots(siteId: string, serviceId: string, date: string): Slot[] {
  const site = db.prepare(`SELECT timezone FROM installations WHERE site_id = ?`).get(siteId) as
    | { timezone: string }
    | undefined;
  const service = db
    .prepare(`SELECT duration_minutes FROM services WHERE id = ? AND site_id = ? AND active = 1`)
    .get(serviceId, siteId) as { duration_minutes: number } | undefined;
  if (!site || !service) return [];

  const blackout = db.prepare(`SELECT 1 FROM blackout_dates WHERE site_id = ? AND date = ?`).get(siteId, date);
  if (blackout) return [];

  const rules = db
    .prepare(`SELECT start_time, end_time FROM availability_rules WHERE site_id = ? AND day_of_week = ?`)
    .all(siteId, dayOfWeek(date)) as Array<{ start_time: string; end_time: string }>;

  const dayStart = zonedToUtcMs(date, "00:00", site.timezone);
  const dayEnd = dayStart + 36 * 3600 * 1000; // generous window covering DST-shifted days
  const booked = db
    .prepare(
      `SELECT start_utc, end_utc FROM bookings
       WHERE site_id = ? AND status = 'confirmed' AND start_utc < ? AND end_utc > ?`
    )
    .all(siteId, new Date(dayEnd).toISOString(), new Date(dayStart).toISOString()) as Array<{
    start_utc: string;
    end_utc: string;
  }>;
  const busy = booked.map((b) => [Date.parse(b.start_utc), Date.parse(b.end_utc)] as const);

  const durationMs = service.duration_minutes * 60000;
  const now = Date.now();
  const slots: Slot[] = [];

  for (const rule of rules) {
    const windowStart = zonedToUtcMs(date, rule.start_time, site.timezone);
    const windowEnd = zonedToUtcMs(date, rule.end_time, site.timezone);
    for (let t = windowStart; t + durationMs <= windowEnd; t += SLOT_STEP_MINUTES * 60000) {
      if (t <= now) continue;
      const end = t + durationMs;
      if (busy.some(([bs, be]) => t < be && end > bs)) continue;
      slots.push({ startUtc: new Date(t).toISOString(), endUtc: new Date(end).toISOString() });
    }
  }
  return slots.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

/** In-memory critical-section lock keyed by site+start, preventing double-booking races
 * between the availability re-check and the insert. Single-process; swap for a DB
 * unique constraint / advisory lock when scaling horizontally. */
const locks = new Map<string, Promise<void>>();

export async function withSlotLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => (release = r));
  locks.set(key, previous.then(() => current));
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

export function isSlotFree(siteId: string, serviceId: string, startUtc: string, excludeBookingId?: string): boolean {
  const service = db
    .prepare(`SELECT duration_minutes FROM services WHERE id = ? AND site_id = ?`)
    .get(serviceId, siteId) as { duration_minutes: number } | undefined;
  if (!service) return false;
  const start = Date.parse(startUtc);
  const end = start + service.duration_minutes * 60000;
  const conflict = db
    .prepare(
      `SELECT 1 FROM bookings WHERE site_id = ? AND status = 'confirmed' AND id != ? AND start_utc < ? AND end_utc > ?`
    )
    .get(siteId, excludeBookingId ?? "", new Date(end).toISOString(), new Date(start).toISOString());
  return !conflict;
}
