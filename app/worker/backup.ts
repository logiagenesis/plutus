// Backup and restore.
// Backup: a signed-in user downloads every table (except login sessions) as one JSON file, read in pages.
// Restore: only on a completely blank database, only while RESTORE_ENABLED is "1", and only for someone
// who knows the password of a user inside the backup. Used to move Plutus to a new Cloudflare account.
import { AuthError, type Env } from "./auth";
import { pbkdf2, sameHex, unhex, hex, sha256 } from "./login";


export const BACKUP_FORMAT = "plutus-backup";
export const BACKUP_VERSION = 1;
const EMPTY_TABLES = new Set(["sessions"]); // structure is copied, rows (login sessions) never leave the instance
const PAGE = 500;
const RESTORE_MAX_ROWS = 200;
const JOB = "_plutus_restore_job";

type SchemaRow = { type: "table" | "index"; name: string; tbl_name: string; sql: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (msg: string, status = 400) => new AuthError(msg, status);
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** User tables and indexes, excluding SQLite/Cloudflare internals and login sessions. */
async function schema(env: Env): Promise<SchemaRow[]> {
  const r = await env.DB.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> ? ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, rowid",
  ).bind(JOB).all<SchemaRow>();
  return r.results;
}

/** Tables in an order where every referenced table comes first (foreign keys). */
export function insertOrder(tables: SchemaRow[]): string[] {
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map(tables.map((t) => [t.name, new Set([...(t.sql ?? "").matchAll(/REFERENCES\s+"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]).filter((n) => n !== t.name && names.has(n)))]));
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string, path: Set<string>) => {
    if (seen.has(n)) return;
    if (path.has(n)) throw new Error("Circular table references: " + n);
    path.add(n);
    for (const d of deps.get(n) ?? []) visit(d, path);
    path.delete(n); seen.add(n); out.push(n);
  };
  for (const t of tables) visit(t.name, new Set());
  return out;
}

async function counts(env: Env, tables: string[], forBackup = false) {
  if (!tables.length) return {};
  if (forBackup) tables = tables.filter((t) => !EMPTY_TABLES.has(t));
  const r = await env.DB.batch(tables.map((t) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${q(t)}`)));
  const out: Record<string, number> = Object.fromEntries(tables.map((t, i) => [t, (r[i].results[0] as { n: number }).n]));
  if (forBackup) for (const t of EMPTY_TABLES) out[t] = 0;
  return out;
}

async function isBlank(env: Env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> ?").bind(JOB).first<{ n: number }>();
  return (r?.n ?? 0) === 0;
}

// ───────── backup (signed-in) ─────────
export async function handleBackup(env: Env, url: URL, path: string): Promise<Response> {
  const s = await schema(env);
  const tables = s.filter((x) => x.type === "table");
  if (path === "schema") {
    return json({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), source: url.origin, schema: s, order: insertOrder(tables), counts: await counts(env, tables.map((t) => t.name), true), emptyTables: [...EMPTY_TABLES] });
  }
  if (path === "rows") {
    const table = url.searchParams.get("table") ?? "";
    if (!tables.some((t) => t.name === table)) throw fail("Unknown table.", 404);
    if (EMPTY_TABLES.has(table)) return json({ table, rows: [], last: null, done: true });
    const after = Number(url.searchParams.get("after") ?? "0");
    if (!Number.isSafeInteger(after)) throw fail("Bad page.");
    const r = await env.DB.prepare(`SELECT rowid AS __rowid, * FROM ${q(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`).bind(after, PAGE).all<Record<string, unknown>>();
    const rows = r.results.map(({ __rowid, ...rest }) => rest);
    const last = r.results.length ? Number(r.results[r.results.length - 1].__rowid) : null;
    return json({ table, rows, last, done: r.results.length < PAGE });
  }
  throw fail("Not found", 404);
}

// ───────── restore (blank database only) ─────────
type Job = { token_hash: string; expires_at: string; schema_json: string; counts_json: string };

async function job(env: Env, token: unknown): Promise<{ schema: SchemaRow[]; counts: Record<string, number> }> {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw fail("Restore session missing.", 401);
  const exists = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").bind(JOB).first();
  if (!exists) throw fail("No restore is in progress.", 409);
  const j = await env.DB.prepare(`SELECT * FROM ${JOB} WHERE token_hash = ? AND expires_at > ?`).bind(await sha256(token), new Date().toISOString()).first<Job>();
  if (!j) throw fail("Restore session expired or wrong. Start again on a blank database.", 401);
  return { schema: JSON.parse(j.schema_json), counts: JSON.parse(j.counts_json) };
}

function cleanSchema(input: unknown): SchemaRow[] {
  if (!Array.isArray(input) || input.length > 200) throw fail("Backup schema is missing or too large.");
  return input.map((s: any) => {
    if (!s || (s.type !== "table" && s.type !== "index") || typeof s.name !== "string" || typeof s.tbl_name !== "string") throw fail("Backup schema is damaged.");
    if (!/^[A-Za-z0-9_]+$/.test(s.name) || s.name.startsWith("sqlite_") || s.name.startsWith("_cf_") || s.name === JOB) throw fail("Backup has an unsafe table name: " + s.name);
    const sql = s.sql == null ? null : String(s.sql);
    if (s.type === "table" && !/^CREATE TABLE\s/i.test(sql ?? "")) throw fail("Backup table definition is damaged: " + s.name);
    if (s.type === "index" && sql !== null && !/^CREATE (UNIQUE )?INDEX\s/i.test(sql)) throw fail("Backup index definition is damaged: " + s.name);
    if (sql && sql.includes(";")) throw fail("Backup definition contains more than one statement: " + s.name);
    return { type: s.type, name: s.name, tbl_name: s.tbl_name, sql };
  });
}

async function insertRows(env: Env, table: string, rows: unknown) {
  if (!Array.isArray(rows) || rows.length > RESTORE_MAX_ROWS) throw fail(`Send between 1 and ${RESTORE_MAX_ROWS} rows at a time.`);
  if (!rows.length) return 0;
  const info = await env.DB.prepare(`PRAGMA table_info(${q(table)})`).all<{ name: string }>();
  const cols = new Set(info.results.map((c) => c.name));
  const stmts = rows.map((row: any) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw fail("A row in the backup is damaged.");
    const keys = Object.keys(row);
    for (const k of keys) if (!cols.has(k)) throw fail(`Column ${k} does not exist in ${table}.`);
    const vals = keys.map((k) => { const v = row[k]; if (v !== null && typeof v === "object") throw fail("A value in the backup is damaged."); return v; });
    return env.DB.prepare(`INSERT INTO ${q(table)} (${keys.map(q).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...vals);
  });
  await env.DB.batch(stmts);
  return rows.length;
}

export async function handleRestore(req: Request, env: Env, path: string): Promise<Response> {
  // Restore needs BOTH the switch and a one-time restore code stored as a Cloudflare secret (RESTORE_CODE).
  // The password inside an uploaded backup can't prove anything on its own: whoever makes the file
  // chooses that password (audit F02).
  const enabled = env.RESTORE_ENABLED === "1" && typeof env.RESTORE_CODE === "string" && env.RESTORE_CODE.length >= 16;
  if (path === "state" && req.method === "GET") return json({ enabled, blank: enabled ? await isBlank(env) : false });
  if (!enabled) throw fail("Restore is switched off on this Plutus.", 403);
  if (req.method !== "POST") throw fail("Not found", 404);
  const b = (await req.json()) as Record<string, any>;

  if (path === "begin") {
    if (typeof b.restoreCode !== "string" || !sameHex(await sha256(b.restoreCode), await sha256(env.RESTORE_CODE!))) throw fail("The restore code is wrong.", 401);
    if (!(await isBlank(env))) throw fail("This Plutus already has data. Restore only works on a blank database.", 409);
    if (b.format !== BACKUP_FORMAT || b.version !== BACKUP_VERSION) throw fail("This is not a Plutus backup file.");
    const s = cleanSchema(b.schema);
    const tables = s.filter((x) => x.type === "table");
    const counts = b.counts as Record<string, number>;
    if (!counts || tables.some((t) => !Number.isSafeInteger(counts[t.name]))) throw fail("Backup row counts are missing.");
    // Prove ownership: the password must match a user inside the backup.
    const users = Array.isArray(b.users) ? b.users : [];
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    const password = typeof b.password === "string" ? b.password : "";
    const u = users.find((x: any) => typeof x?.email === "string" && x.email.toLowerCase() === email);
    if (!u?.password_hash || !u.password_salt) throw fail("Email or password is wrong.", 401);
    const got = await pbkdf2(password, unhex(String(u.password_salt)), Number(u.password_iterations) || 25_000);
    if (!sameHex(got, String(u.password_hash))) throw fail("Email or password is wrong.", 401);
    if (users.length !== counts["users"]) throw fail("The backup's user list does not match its counts.");
    // Create the tables (indexes come at the end), the job record, and the users.
    const order = insertOrder(tables);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.batch([
      ...order.map((n) => env.DB.prepare(tables.find((t) => t.name === n)!.sql!)),
      env.DB.prepare(`CREATE TABLE ${JOB} (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, schema_json TEXT NOT NULL, counts_json TEXT NOT NULL)`),
      env.DB.prepare(`INSERT INTO ${JOB} VALUES (?, ?, ?, ?)`).bind(await sha256(token), new Date(Date.now() + 2 * 3600_000).toISOString(), JSON.stringify(s), JSON.stringify(counts)),
    ]);
    if (users.length) await insertRows(env, "users", users);
    return json({ ok: true, token, order });
  }
  if (path === "rows") {
    const j = await job(env, b.token);
    const table = String(b.table ?? "");
    if (table === "users") throw fail("Users were restored at the start.");
    if (EMPTY_TABLES.has(table)) throw fail("That table is never restored.");
    if (!j.schema.some((t) => t.type === "table" && t.name === table)) throw fail("Unknown table.", 404);
    return json({ ok: true, inserted: await insertRows(env, table, b.rows) });
  }
  if (path === "finish") {
    const j = await job(env, b.token);
    const tables = j.schema.filter((t) => t.type === "table").map((t) => t.name);
    const have = await counts(env, tables);
    const wrong = tables.filter((t) => have[t] !== j.counts[t]);
    if (wrong.length) return json({ ok: false, error: "Row counts do not match yet.", wrong: wrong.map((t) => ({ table: t, expected: j.counts[t], got: have[t] })) }, 409);
    const idx = j.schema.filter((t) => t.type === "index" && t.sql);
    await env.DB.batch([...idx.map((i) => env.DB.prepare(i.sql!)), env.DB.prepare(`DROP TABLE ${JOB}`)]);
    try { await env.DB.prepare("INSERT INTO audit_events (actor, action, entity, detail_json) VALUES ('restore', 'restored_from_backup', 'system', ?)").bind(JSON.stringify({ counts: have, source: b.source ?? null })).run(); } catch { /* audit table shape may differ in old backups */ }
    return json({ ok: true, counts: have });
  }
  throw fail("Not found", 404);
}
