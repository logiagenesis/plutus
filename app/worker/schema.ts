// Schema upgrades that Plutus applies to its own database on first use after a deploy.
// Why here and not in migrations/: the live database is in a Cloudflare account that the build
// pipeline does not run `wrangler d1 migrations apply` against. Every step below is safe to repeat.
import type { Env } from "./auth";

const ready = new WeakMap<object, Promise<void>>(); // once per database binding per isolate

async function columns(env: Env, table: string): Promise<Set<string>> {
  const r = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set(r.results.map((c) => c.name));
}

async function upgrade(env: Env) {
  // A blank database (before a restore) has no tables: leave it untouched.
  // One cheap query; if everything is already in place (the normal case) nothing else runs.
  const c = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='documents') AS docs,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='payments') AS pays,
      (SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name IN ('edit_token','company_snapshot_json')) AS cols`).first<{ docs: number; pays: number; cols: number }>();
  if (!c?.docs) return;
  if (c.pays === 1 && c.cols === 2) return;
  const doc = await columns(env, "documents");
  const st: D1PreparedStatement[] = [];
  // Per-save token: only the request that actually updated the header may replace the lines (audit F01).
  if (!doc.has("edit_token")) st.push(env.DB.prepare("ALTER TABLE documents ADD COLUMN edit_token TEXT"));
  // Issuing company frozen at issue time, like the customer snapshot (audit F03).
  if (!doc.has("company_snapshot_json")) st.push(env.DB.prepare("ALTER TABLE documents ADD COLUMN company_snapshot_json TEXT"));
  st.push(env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL REFERENCES companies(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    method TEXT,
    reference TEXT,
    note TEXT,
    client_key TEXT UNIQUE,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    voided_at TEXT,
    voided_by TEXT
  )`));
  st.push(env.DB.prepare("CREATE INDEX IF NOT EXISTS payments_document ON payments(document_id)"));
  try { await env.DB.batch(st); }
  catch (e) {
    // Another request may have upgraded at the same moment; fine if everything is now in place.
    const now = await columns(env, "documents");
    const pay = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payments'").first();
    if (!(now.has("edit_token") && now.has("company_snapshot_json") && pay)) throw e;
  }
}

export function ensureSchema(env: Env): Promise<void> {
  let p = ready.get(env.DB);
  if (!p) { p = upgrade(env).catch((e) => { ready.delete(env.DB); throw e; }); ready.set(env.DB, p); }
  return p;
}
