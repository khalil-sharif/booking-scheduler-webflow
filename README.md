# booking-scheduler-webflow

A Webflow App for appointment booking: a Designer Extension for configuration, an
embeddable vanilla-JS widget for visitors, and CMS-mirrored bookings the site owner can see in the CMS.

## Data flow

```
Visitor  -> widget/booking-widget.js -> GET /api/availability  (slots computed server-side, site timezone)
                                     -> POST /api/bookings     (slot lock + re-check -> DB insert -> CMS item)
Owner    -> Designer Extension panel -> services / weekly rules / blackout dates / embed snippet
Webflow CMS  <- Services + Bookings collections (created on install)
```

## Embed
```html
<div id="booking-widget"></div>
<script src="https://<app-host>/widget/booking-widget.js" data-site="PUBLIC_KEY" data-api-base="https://<app-host>"></script>
```
`PUBLIC_KEY` is shown in the App Panel and only scopes read access to services/availability and booking creation for that site.

## Availability rule format
Weekly rules: `{ dayOfWeek: 0-6 (Sun=0), startTime: "HH:MM", endTime: "HH:MM" }` in the **site timezone**, plus one-off blackout dates (`YYYY-MM-DD`). Slots are generated every 15 minutes wherever the service duration fits inside a window and does not overlap a confirmed booking.

## Double-booking protection
`POST /api/bookings` runs the availability re-check and insert inside a per-slot in-memory lock (`withSlotLock`) and returns **409** when the slot was taken; the widget rolls back its optimistic confirmation and refreshes slots. For multi-instance deployments replace the lock with a DB unique constraint or advisory lock.

## Reschedule / cancel
The confirmation email links to `/api/bookings/manage/{token}` (HMAC-signed opaque token, no login). `PATCH` reschedules (re-runs availability), `DELETE` cancels; both sync to the CMS item.

## Timezones
Slots are computed server-side in the site's timezone (captured at install); the widget renders times in the visitor's local zone with `Intl.DateTimeFormat`.

## Emails
`server/services/mailer.ts` logs the would-be send and builds an `.ics` invite; swap it for a real provider.

## Uninstall
`POST /webhooks/app-uninstalled` clears the stored token. Existing CMS collections/items are **not** deleted (they belong to the site owner); local booking history is retained.

## OAuth scopes
`sites:read`, `cms:read`, `cms:write`.

## Local dev
`cp .env.example .env`, add OAuth credentials, expose via tunnel for webhooks. Source-only: no install/build/test was run.
