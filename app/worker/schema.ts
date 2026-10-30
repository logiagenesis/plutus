// Schema upgrades that Plutus applies to its own database on first use after a deploy.
// Why here and not in migrations/: the live database is in a Cloudflare account that the build
// pipeline does not run `wrangler d1 migrations apply` against. Every step below is safe to repeat.
import type { Env } from "./auth";

const ready = new WeakMap<object, Promise<boolean>>(); // once per database binding per isolate

async function columns(env: Env, table: string): Promise<Set<string>> {
  const r = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set(r.results.map((c) => c.name));
}

async function upgrade(env: Env): Promise<boolean> {
  // A blank database (before a restore) has no tables: leave it untouched and do NOT mark ready.
  const c = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='documents') AS docs,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='payments') AS pays,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='email_messages') AS emails,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='bank_transactions') AS btx,
      (SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name IN ('edit_token','company_snapshot_json','sent_at','sent_to','recurring_template_id','recurring_period')) AS cols`).first<{ docs: number; pays: number; emails: number; btx: number; cols: number }>();
  if (!c?.docs) return false;
  if (c.pays === 1 && c.emails === 1 && c.btx === 1 && c.cols === 6) return true;
  const doc = await columns(env, "documents");
  const st: D1PreparedStatement[] = [];
  // Per-save token: only the request that actually updated the header may replace the lines (audit F01).
  if (!doc.has("edit_token")) st.push(env.DB.prepare("ALTER TABLE documents ADD COLUMN edit_token TEXT"));
  // Issuing company frozen at issue time, like the customer snapshot (audit F03).
  if (!doc.has("company_snapshot_json")) st.push(env.DB.prepare("ALTER TABLE documents ADD COLUMN company_snapshot_json TEXT"));
  // Tracking outbound delivery timestamp and recipient (Piece 2).
  if (!doc.has("sent_at")) st.push(env.DB.prepare("ALTER TABLE documents ADD COLUMN sent_at TEXT"));
  if (!doc.has("sent_to")) st.push(env.DB.prepare("ALTER TABLE documents ADD COLUMN sent_to TEXT"));
  // Recurring batch idempotency: strictly one invoice per template per period (Piece 3).
  if (!doc.has("recurring_template_id")) st.push(env.DB.prepare("ALTER TABLE documents ADD COLUMN recurring_template_id INTEGER REFERENCES recurring_templates(id)"));
  if (!doc.has("recurring_period")) st.push(env.DB.prepare("ALTER TABLE documents ADD COLUMN recurring_period TEXT"));

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

  st.push(env.DB.prepare(`CREATE TABLE IF NOT EXISTS email_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL REFERENCES companies(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    recipient_email TEXT NOT NULL,
    cc_email TEXT,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    provider_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`));
  st.push(env.DB.prepare("CREATE INDEX IF NOT EXISTS emails_document ON email_messages(document_id)"));
  st.push(env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS doc_recurring_unique ON documents(recurring_template_id, recurring_period) WHERE status <> 'void'"));

  // Piece 4: Bank reconciliation
  st.push(env.DB.prepare(`CREATE TABLE IF NOT EXISTS bank_statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL REFERENCES companies(id),
    filename TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    checksum TEXT,
    imported_by TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`));

  st.push(env.DB.prepare(`CREATE TABLE IF NOT EXISTS bank_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id INTEGER NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id),
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    balance_cents INTEGER,
    transaction_hash TEXT NOT NULL,
    matched_document_id INTEGER REFERENCES documents(id),
    matched_at TEXT,
    match_type TEXT,
    status TEXT NOT NULL DEFAULT 'unmatched',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`));
  st.push(env.DB.prepare("CREATE INDEX IF NOT EXISTS bank_tx_company_status ON bank_transactions(company_id, status)"));
  st.push(env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS bank_tx_hash_unique ON bank_transactions(company_id, transaction_hash)"));
  st.push(env.DB.prepare("CREATE INDEX IF NOT EXISTS bank_tx_matched_doc ON bank_transactions(matched_document_id)"));

  try { await env.DB.batch(st); }
  catch (e) {
    // Another request may have upgraded at the same moment; fine if everything is now in place.
    const now = await columns(env, "documents");
    const pay = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payments'").first();
    const em = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_messages'").first();
    const btx = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_transactions'").first();
    if (!(now.has("edit_token") && now.has("company_snapshot_json") && now.has("sent_at") && now.has("recurring_template_id") && pay && em && btx)) throw e;
  }
  return true;
}

export async function ensureSchema(env: Env): Promise<void> {
  let p = ready.get(env.DB);
  if (!p) {
    const promise = upgrade(env).then((done) => {
      if (!done) ready.delete(env.DB); // don't cache blank DB state
      return done;
    }).catch((e) => { ready.delete(env.DB); throw e; });
    p = promise;
    ready.set(env.DB, p);
  }
  await p;
}
