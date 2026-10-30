// Cloudflare Access check. Plutus now has its own login (see login.ts); Access is only used
// to allow setting the very first password. Fails closed: no valid Access token means no.
export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string; // e.g. https://logi-ink.cloudflareaccess.com
  ACCESS_AUD?: string;         // Application Audience (AUD) tag from the Access application
  DEV_BYPASS?: string;         // "1" only in local development (.dev.vars), never in production
  RESTORE_ENABLED?: string;    // "1" only while moving Plutus to a new account (restore into a blank database)
  RESTORE_CODE?: string;       // Cloudflare secret, set by the owner only for the restore; restore is off without it
  RESEND_API_KEY?: string;     // Transactional email API key (e.g. from Resend or Postmark)
  EMAIL_FROM?: string;         // Default sender address (defaults to accounts@logia.co.za)
};

type Jwk = JsonWebKey & { kid: string };
let certCache: { at: number; keys: Jwk[] } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function keys(team: string): Promise<Jwk[]> {
  if (certCache && Date.now() - certCache.at < 10 * 60_000) return certCache.keys;
  const r = await fetch(`${team.replace(/\/$/, "")}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("Could not load Access certificates");
  const body = (await r.json()) as { keys: Jwk[] };
  certCache = { at: Date.now(), keys: body.keys };
  return body.keys;
}

export class AuthError extends Error { constructor(msg: string, public status = 401) { super(msg); } }

/** Email from a valid Cloudflare Access token on this request, or null. */
export async function accessEmail(req: Request, env: Env): Promise<string | null> {
  if (env.DEV_BYPASS === "1") return "dev@localhost";
  if (!req.headers.get("Cf-Access-Jwt-Assertion")) return null;
  try { return await requireAccess(req, env); } catch { return null; }
}

async function requireAccess(req: Request, env: Env): Promise<string> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new AuthError("Access is not configured.", 503);
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AuthError("Not signed in.");
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new AuthError("Invalid sign-in token.");
  const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new AuthError("Unsupported sign-in token.");
  let jwk = (await keys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) { certCache = null; jwk = (await keys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid); }
  if (!jwk) throw new AuthError("Unknown sign-in key.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new AuthError("Sign-in token signature is invalid.");
  const claims = JSON.parse(new TextDecoder().decode(b64url(p))) as { aud?: string | string[]; exp?: number; email?: string; iss?: string };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new AuthError("Sign-in token is for a different application.");
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new AuthError("Sign-in has expired. Reload the page.");
  if (claims.iss && claims.iss.replace(/\/$/, "") !== env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "")) throw new AuthError("Sign-in token issuer mismatch.");
  return claims.email ?? "unknown";
}
