// Plutus's own login: email + password, stored only as a salted PBKDF2-SHA256 hash.
// Sessions are random tokens in an HttpOnly, Secure, SameSite=Strict cookie; only their SHA-256 is stored.
import { AuthError, accessEmail, type Env } from "./auth";

const COOKIE = "plutus_session";
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// Kept within the Workers Free plan CPU limit (10 ms per request). Stored per user, so it can be raised later.
export const ITERATIONS = 25_000;
export const MIN_LENGTH = 12;

const enc = new TextEncoder();
export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const now = () => new Date().toISOString();

export async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
export function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

export function checkNewPassword(p: unknown): string {
  if (typeof p !== "string" || p.length < MIN_LENGTH) throw new AuthError(`Use at least ${MIN_LENGTH} characters.`, 400);
  if (p.length > 200) throw new AuthError("That password is too long.", 400);
  return p;
}
async function hashNew(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await pbkdf2(password, salt, ITERATIONS), salt: hex(salt), iterations: ITERATIONS };
}

function cookie(token: string, maxAge: number) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function readCookie(req: Request) {
  const m = (req.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return m?.[1] ?? null;
}
async function newSession(env: Env, userId: number) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), userId, expires),
  ]);
  return cookie(token, SESSION_HOURS * 3600);
}

type UserRow = { id: number; email: string; password_hash: string | null; password_salt: string | null; password_iterations: number | null; failed_count: number; locked_until: string | null };

/** The signed-in user's email, or null. */
export async function sessionEmail(req: Request, env: Env): Promise<string | null> {
  const token = readCookie(req);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?").bind(await sha256(token), now()).first<{ email: string }>();
  return row?.email ?? null;
}
export async function requireSession(req: Request, env: Env): Promise<string> {
  const email = await sessionEmail(req, env);
  if (!email) throw new AuthError("Please sign in.");
  return email;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

async function audit(env: Env, actor: string, action: string, detail?: unknown) {
  await env.DB.prepare("INSERT INTO audit_events (actor, action, entity, detail_json) VALUES (?, ?, 'login', ?)").bind(actor, action, detail ? JSON.stringify(detail) : null).run();
}

/** Handles /api/auth/*. Returns null when the path is not an auth path. */
export async function handleAuth(req: Request, env: Env, path: string): Promise<Response | null> {
  const m = req.method;
  if (path === "state" && m === "GET") {
    const email = await sessionEmail(req, env);
    const pending = await env.DB.prepare("SELECT email FROM users WHERE password_hash IS NULL ORDER BY id LIMIT 1").first<{ email: string }>();
    const setupAllowed = !!pending && !!(await accessEmail(req, env));
    return json({ signedIn: !!email, email, setupNeeded: !!pending, setupEmail: setupAllowed ? pending!.email : null, setupAllowed });
  }
  if (path === "setup" && m === "POST") {
    // First password can only be set while the request also passes the owner's Cloudflare sign-in.
    const via = await accessEmail(req, env);
    if (!via) throw new AuthError("Setting the first password is not available here.", 403);
    const body = (await req.json()) as { password?: unknown };
    const password = checkNewPassword(body.password);
    const u = await env.DB.prepare("SELECT id, email FROM users WHERE password_hash IS NULL ORDER BY id LIMIT 1").first<{ id: number; email: string }>();
    if (!u) throw new AuthError("The password has already been set. Sign in instead.", 409);
    const h = await hashNew(password);
    const r = await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_set_at = ?, failed_count = 0, locked_until = NULL WHERE id = ? AND password_hash IS NULL").bind(h.hash, h.salt, h.iterations, now(), u.id).run();
    if (!r.meta.changes) throw new AuthError("The password has already been set. Sign in instead.", 409);
    await audit(env, u.email, "password_set", { via });
    return json({ ok: true, email: u.email }, 200, { "set-cookie": await newSession(env, u.id) });
  }
  if (path === "login" && m === "POST") {
    const body = (await req.json()) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const u = await env.DB.prepare("SELECT id, email, password_hash, password_salt, password_iterations, failed_count, locked_until FROM users WHERE email = ?").bind(email).first<UserRow>();
    if (u?.locked_until && u.locked_until > now()) throw new AuthError(`Too many wrong tries. Wait ${LOCK_MINUTES} minutes, then try again.`, 429);
    // Always do the same hashing work, so a wrong email and a wrong password look the same.
    const salt = u?.password_salt ? unhex(u.password_salt) : enc.encode("plutus-no-such-user");
    const got = await pbkdf2(password, salt, u?.password_iterations ?? ITERATIONS);
    const ok = !!u?.password_hash && password.length > 0 && sameHex(got, u.password_hash);
    if (!ok) {
      if (u) {
        const fails = u.failed_count + 1;
        const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
        await env.DB.prepare("UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?").bind(lock ? 0 : fails, lock, u.id).run();
        if (lock) await audit(env, u.email, "login_locked");
      }
      throw new AuthError("Email or password is wrong.");
    }
    await env.DB.prepare("UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?").bind(u!.id).run();
    await audit(env, u!.email, "signed_in");
    return json({ ok: true, email: u!.email }, 200, { "set-cookie": await newSession(env, u!.id) });
  }
  if (path === "logout" && m === "POST") {
    const token = readCookie(req);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": cookie("x".repeat(20), 0) });
  }
  if (path === "password" && m === "POST") {
    const email = await requireSession(req, env);
    const body = (await req.json()) as { current?: unknown; next?: unknown };
    const u = (await env.DB.prepare("SELECT id, email, password_hash, password_salt, password_iterations, failed_count, locked_until FROM users WHERE email = ?").bind(email).first<UserRow>())!;
    const cur = typeof body.current === "string" ? body.current : "";
    const got = await pbkdf2(cur, unhex(u.password_salt ?? ""), u.password_iterations ?? ITERATIONS);
    if (!u.password_hash || !sameHex(got, u.password_hash)) throw new AuthError("Your current password is wrong.", 400);
    const next = checkNewPassword(body.next);
    const h = await hashNew(next);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_set_at = ? WHERE id = ?").bind(h.hash, h.salt, h.iterations, now(), u.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
    ]);
    await audit(env, u.email, "password_changed");
    return json({ ok: true }, 200, { "set-cookie": await newSession(env, u.id) });
  }
  return null;
}
