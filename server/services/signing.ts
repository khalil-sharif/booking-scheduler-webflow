import crypto from "crypto";

const SECRET = process.env.APP_SIGNING_SECRET || "dev-secret-change-me";

/** Random opaque token with an HMAC suffix so forged tokens are rejected before a DB lookup. */
export function newManageToken(): string {
  const id = crypto.randomBytes(16).toString("hex");
  const sig = crypto.createHmac("sha256", SECRET).update(id).digest("hex").slice(0, 16);
  return `${id}.${sig}`;
}

export function verifyManageToken(token: string): boolean {
  const [id, sig] = token.split(".");
  if (!id || !sig) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(id).digest("hex").slice(0, 16);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newPublicKey(): string {
  return crypto.randomBytes(12).toString("hex");
}
