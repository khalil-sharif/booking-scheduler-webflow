// Hand-rolled typed client for Webflow Data API v2 (no SDK dependency).

import { db } from "../db";

const API_BASE = "https://api.webflow.com/v2";

class WebflowApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`Webflow API error ${status}: ${JSON.stringify(body)}`);
  }
}

function getAccessToken(siteId: string): string {
  const row = db
    .prepare(`SELECT access_token FROM installations WHERE site_id = ? AND uninstalled_at IS NULL`)
    .get(siteId) as { access_token: string } | undefined;
  if (!row) throw new Error(`No active installation for site ${siteId}`);
  return row.access_token;
}

async function request<T>(siteId: string, method: string, urlPath: string, body?: unknown, retry = 0): Promise<T> {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${getAccessToken(siteId)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && retry < 3) {
    const wait = Number(res.headers.get("Retry-After") || "2") * 1000 * Math.pow(2, retry);
    await new Promise((r) => setTimeout(r, wait));
    return request<T>(siteId, method, urlPath, body, retry + 1);
  }
  if (!res.ok) throw new WebflowApiError(res.status, await res.json().catch(() => ({})));
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export interface FieldDef {
  displayName: string;
  type: string;
}

export const webflowClient = {
  createCollection(siteId: string, displayName: string, slug: string): Promise<{ id: string }> {
    return request(siteId, "POST", `/sites/${siteId}/collections`, { displayName, slug });
  },
  createField(siteId: string, collectionId: string, field: FieldDef): Promise<{ id: string }> {
    return request(siteId, "POST", `/collections/${collectionId}/fields`, field);
  },
  createItem(siteId: string, collectionId: string, fieldData: Record<string, unknown>): Promise<{ id: string }> {
    return request(siteId, "POST", `/collections/${collectionId}/items`, { fieldData, isDraft: false });
  },
  updateItem(siteId: string, collectionId: string, itemId: string, fieldData: Record<string, unknown>): Promise<{ id: string }> {
    return request(siteId, "PATCH", `/collections/${collectionId}/items/${itemId}`, { fieldData });
  },
  getSite(siteId: string): Promise<{ id: string; timeZone?: string }> {
    return request(siteId, "GET", `/sites/${siteId}`);
  },
  registerWebhook(siteId: string, triggerType: string, url: string): Promise<{ id: string }> {
    return request(siteId, "POST", `/sites/${siteId}/webhooks`, { triggerType, url });
  },
};

export { WebflowApiError };
