// Email stub: logs the would-be send. Swap the implementation for a real provider
// (SES, Postmark, Resend...) without touching call sites.

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  icsAttachment?: string;
}

export async function sendMail(email: OutboundEmail): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[mailer] to=${email.to} subject="${email.subject}" ics=${email.icsAttachment ? "yes" : "no"}`);
}

function icsDate(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildIcs(opts: { uid: string; summary: string; startUtc: string; endUtc: string; description?: string }): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//booking-scheduler-webflow//EN",
    "BEGIN:VEVENT",
    `UID:${opts.uid}@booking-scheduler-webflow`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(opts.startUtc)}`,
    `DTEND:${icsDate(opts.endUtc)}`,
    `SUMMARY:${opts.summary}`,
    `DESCRIPTION:${(opts.description || "").replace(/\n/g, "\\n")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function confirmationHtml(name: string, serviceName: string, startUtc: string, manageUrl: string): string {
  return `<p>Hi ${escapeHtml(name)},</p>
<p>Your <strong>${escapeHtml(serviceName)}</strong> appointment is confirmed for ${escapeHtml(startUtc)} (UTC).</p>
<p><a href="${manageUrl}">Reschedule or cancel</a></p>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
