import { Router } from "express";
import { db } from "../db";

const router = Router();

/** On uninstall: revoke stored token and disable the public key. Existing CMS collections/items
 * are intentionally NOT deleted (they belong to the site owner). Local booking history is retained. */
router.post("/app-uninstalled", (req, res) => {
  const siteId = req.body?.payload?.siteId as string | undefined;
  if (!siteId) return void res.status(400).json({ error: "Missing siteId" });
  db.prepare(`UPDATE installations SET access_token = '', uninstalled_at = datetime('now') WHERE site_id = ?`).run(siteId);
  res.status(200).json({ ok: true });
});

export default router;
