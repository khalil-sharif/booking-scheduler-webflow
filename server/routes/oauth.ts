import { Router } from "express";
import { db } from "../db";
import { webflowClient } from "../services/webflow-client";
import { newPublicKey } from "../services/signing";

const router = Router();

const CLIENT_ID = process.env.WEBFLOW_CLIENT_ID || "";
const CLIENT_SECRET = process.env.WEBFLOW_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.WEBFLOW_REDIRECT_URI || "http://localhost:3000/oauth/callback";
const SCOPES = process.env.WEBFLOW_SCOPES || "sites:read,cms:read,cms:write";
const APP_BASE_URL = process.env.APP_PUBLIC_URL || "http://localhost:3000";

router.get("/authorize", (_req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
  });
  res.redirect(`https://webflow.com/oauth/authorize?${params.toString()}`);
});

router.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }

  try {
    const tokenRes = await fetch("https://api.webflow.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) {
      res.status(502).send(`Token exchange failed: ${await tokenRes.text()}`);
      return;
    }
    const tokenJson = (await tokenRes.json()) as { access_token: string; scope?: string };

    const sitesRes = await fetch("https://api.webflow.com/v2/sites", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const sitesJson = (await sitesRes.json()) as { sites: Array<{ id: string; timeZone?: string }> };
    const site = sitesJson.sites?.[0];
    if (!site) {
      res.status(502).send("No site returned for this installation");
      return;
    }

    db.prepare(
      `INSERT INTO installations (site_id, access_token, scopes, timezone, public_key, installed_at, uninstalled_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), NULL)
       ON CONFLICT(site_id) DO UPDATE SET access_token = excluded.access_token, scopes = excluded.scopes, uninstalled_at = NULL`
    ).run(site.id, tokenJson.access_token, tokenJson.scope || SCOPES, site.timeZone || "UTC", newPublicKey());

    await bootstrapCollections(site.id);
    await webflowClient.registerWebhook(site.id, "app_uninstall", `${APP_BASE_URL}/webhooks/app-uninstalled`);

    res.redirect(`/designer-extension/index.html?installed=1&site=${site.id}`);
  } catch (err) {
    res.status(500).send(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

/** Creates Services + Bookings CMS collections so booking data is visible in the CMS UI. */
async function bootstrapCollections(siteId: string): Promise<void> {
  const inst = db
    .prepare(`SELECT services_collection_id, bookings_collection_id FROM installations WHERE site_id = ?`)
    .get(siteId) as { services_collection_id: string | null; bookings_collection_id: string | null };

  if (!inst.services_collection_id) {
    const services = await webflowClient.createCollection(siteId, "Services", "services");
    await webflowClient.createField(siteId, services.id, { displayName: "Duration (minutes)", type: "Number" });
    await webflowClient.createField(siteId, services.id, { displayName: "Price", type: "Number" });
    await webflowClient.createField(siteId, services.id, { displayName: "Description", type: "PlainText" });
    db.prepare(`UPDATE installations SET services_collection_id = ? WHERE site_id = ?`).run(services.id, siteId);
  }

  if (!inst.bookings_collection_id) {
    const bookings = await webflowClient.createCollection(siteId, "Bookings", "bookings");
    for (const f of [
      { displayName: "Customer Email", type: "Email" },
      { displayName: "Service", type: "PlainText" },
      { displayName: "Start Time", type: "DateTime" },
      { displayName: "Status", type: "PlainText" },
    ]) {
      await webflowClient.createField(siteId, bookings.id, f);
    }
    db.prepare(`UPDATE installations SET bookings_collection_id = ? WHERE site_id = ?`).run(bookings.id, siteId);
  }
}

export default router;
