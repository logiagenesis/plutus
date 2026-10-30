// Regression tests for the 30 Oct 2026 audit findings (F01, F02, F04, F08, F10, F11) and payments.
// Runs the real Worker against an in-memory SQLite database shaped like D1. Synthetic data only.
// Run: node tests/worker-regression.mjs   (from app/)
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import assert from "node:assert/strict";

mkdirSync(".test-build", { recursive: true });
await build({ entryPoints: ["worker/index.ts"], bundle: true, platform: "neutral", format: "esm", outfile: ".test-build/worker.mjs", logLevel: "error" });
const { default: worker } = await import(new URL("../.test-build/worker.mjs", import.meta.url));

class DB {
  constructor() { this.db = new DatabaseSync(":memory:"); this.db.exec("PRAGMA foreign_keys=ON"); this.barrier = null; }
  prepare(sql) {
    const d = this;
    return {
      sql, args: [],
      bind(...a) { this.args = a; return this; },
      async first() { const r = d.db.prepare(sql).get(...this.args) ?? null; if (d.barrier && sql.startsWith("SELECT company_id, kind, status, version")) await d.barrier(); return r; },
      async all() { return { results: d.db.prepare(sql).all(...this.args) }; },
      async run() { const r = d.db.prepare(sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; },
    };
  }
  async batch(st) {
    this.db.exec("BEGIN");
    try {
      const out = st.map((s) => { const results = this.db.prepare(s.sql).all(...s.args); return { results, meta: { changes: Number(this.db.prepare("SELECT changes() n").get().n) } }; });
      this.db.exec("COMMIT"); return out;
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
}

function freshDb() {
  const db = new DB();
  for (const f of ["0001_initial.sql", "0002_own_login.sql"]) db.db.exec(readFileSync("migrations/" + f, "utf8"));
  db.db.exec("UPDATE companies SET set_up = 1");
  db.db.exec("INSERT INTO customers(company_id,name) VALUES('logia-services','Test customer'); INSERT INTO items(company_id,description) VALUES('logi-ink','Other company item'); INSERT INTO items(company_id,description) VALUES('logia-services','Own item')");
  return db;
}
const token = "a".repeat(64);
async function session(db) {
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
  db.db.prepare("UPDATE users SET password_hash='x', password_salt='00', password_iterations=1 WHERE id=1").run();
  db.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,1,?)").run(hash, "2099-01-01");
}
const envFor = (db, extra = {}) => ({ DB: db, ASSETS: { fetch: () => new Response("x") }, ...extra });
async function call(env, path, method = "GET", body, auth = true) {
  const r = await worker.fetch(new Request("https://test.invalid/api/" + path, { method, headers: { "content-type": "application/json", ...(auth ? { cookie: "plutus_session=" + token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
  return { status: r.status, body: await r.json() };
}
const doc = { companyId: "logia-services", kind: "invoice", customerId: 1, date: "2026-10-30", vat: false, lines: [{ description: "Service", quantity: "1", unitPriceExclCents: 100, discountPercent: "0" }] };
let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log("PASS", name); };

const db = freshDb(); await session(db); const env = envFor(db);

ok("unauthenticated request refused", (await call(env, "bootstrap", "GET", undefined, false)).status === 401);
let r = await call(env, "documents", "POST", doc);
ok("create draft", r.status === 200);
const id = r.body.id;

// F11
ok("impossible date refused", (await call(env, "documents", "POST", { ...doc, date: "2026-99-99" })).status === 400);
ok("31 November refused", (await call(env, "documents", "POST", { ...doc, date: "2026-11-31" })).status === 400);
ok("leap day 2028 accepted", (await call(env, "documents", "POST", { ...doc, date: "2028-02-29" })).status === 200);
ok("due before date refused", (await call(env, "documents", "POST", { ...doc, dueDate: "2026-10-01" })).status === 400);
ok("huge quantity refused", (await call(env, "documents", "POST", { ...doc, lines: [{ ...doc.lines[0], quantity: "99999999" }] })).status === 400);
ok("huge price refused", (await call(env, "documents", "POST", { ...doc, lines: [{ ...doc.lines[0], unitPriceExclCents: 9_000_000_000_000 }] })).status === 400);

// F10
ok("other company's item refused", (await call(env, "documents", "POST", { ...doc, lines: [{ ...doc.lines[0], itemId: 1 }] })).status === 400);
ok("own item accepted", (await call(env, "documents", "POST", { ...doc, lines: [{ ...doc.lines[0], itemId: 2 }] })).status === 200);

// F01: two saves of the same draft at the same moment
const wait = []; db.barrier = () => new Promise((res) => { wait.push(res); if (wait.length === 2) { db.barrier = null; wait.forEach((f) => f()); } });
const both = await Promise.all([
  call(env, "documents/" + id, "PUT", { ...doc, version: 1, lines: [{ ...doc.lines[0], unitPriceExclCents: 200 }] }),
  call(env, "documents/" + id, "PUT", { ...doc, version: 1, lines: [{ ...doc.lines[0], unitPriceExclCents: 300 }] }),
]);
const head = db.db.prepare("SELECT total_cents, version FROM documents WHERE id=?").get(id);
const lines = db.db.prepare("SELECT SUM(total_cents) t, COUNT(*) n FROM document_lines WHERE document_id=?").get(id);
ok("concurrent saves: one wins, one refused", both.map((b) => b.status).sort().join() === "200,409");
ok("concurrent saves: header total equals line total", head.total_cents === lines.t && lines.n === 1);

// Issue guard: a header that disagrees with its lines can't be issued
const bad = (await call(env, "documents", "POST", doc)).body.id;
db.db.prepare("UPDATE document_lines SET total_cents = 999 WHERE document_id = ?").run(bad);
ok("mismatched draft cannot be issued", (await call(env, "documents/" + bad + "/issue", "POST", { version: 1 })).status === 409);

r = await call(env, "documents/" + id + "/issue", "POST", { version: head.version });
ok("issue", r.status === 200 && r.body.number === "INV00000001");
ok("company snapshot stored on issue", JSON.parse(r.body.company_snapshot_json).id === "logia-services");
ok("issued document locked", (await call(env, "documents/" + id, "PUT", { ...doc, version: r.body.version })).status === 409);

// F03: renaming the customer does not change the issued snapshot
db.db.prepare("UPDATE customers SET name='Renamed' WHERE id=1").run();
ok("customer snapshot unchanged after rename", JSON.parse((await call(env, "documents/" + id)).body.customer_snapshot_json).name === "Test customer");

// F04: retried create with same key, and double conversion of one quote
const key = "11111111-2222-3333-4444-555555555555";
const k1 = await call(env, "documents", "POST", { ...doc, clientKey: key });
const k2 = await call(env, "documents", "POST", { ...doc, clientKey: key });
ok("same key twice gives one draft", k1.body.id === k2.body.id && k2.body.existing === true);
const q = (await call(env, "documents", "POST", { ...doc, kind: "quote" })).body;
await call(env, "documents/" + q.id + "/issue", "POST", { version: 1 });
const conv = await Promise.all([call(env, "documents", "POST", { ...doc, fromDocumentId: q.id }), call(env, "documents", "POST", { ...doc, fromDocumentId: q.id })]);
ok("quote converted twice gives one invoice", conv[0].body.id === conv[1].body.id && conv.every((c) => c.status === 200));
ok("copying an invoice twice is still allowed", (await call(env, "documents", "POST", { ...doc, fromDocumentId: id })).body.id !== (await call(env, "documents", "POST", { ...doc, fromDocumentId: id })).body.id);

// Payments
const inv = (await call(env, "documents", "POST", { ...doc, lines: [{ ...doc.lines[0], unitPriceExclCents: 10000 }] })).body;
await call(env, "documents/" + inv.id + "/issue", "POST", { version: 1 });
ok("payment on draft refused", (await call(env, "documents/" + (await call(env, "documents", "POST", doc)).body.id + "/payments", "POST", { date: "2026-10-30", amountCents: 1 })).status === 400);
const pk = "99999999-2222-3333-4444-555555555555";
r = await call(env, "documents/" + inv.id + "/payments", "POST", { date: "2026-10-30", amountCents: 4000, clientKey: pk });
ok("part payment recorded", r.status === 200 && r.body.payments.length === 1);
ok("same payment twice is recorded once", (await call(env, "documents/" + inv.id + "/payments", "POST", { date: "2026-10-30", amountCents: 4000, clientKey: pk })).body.payments.length === 1);
ok("overpayment refused", (await call(env, "documents/" + inv.id + "/payments", "POST", { date: "2026-10-30", amountCents: 6001 })).status === 409);
r = await call(env, "documents/" + inv.id + "/payments", "POST", { date: "2026-10-30", amountCents: 6000 });
ok("paid in full", r.status === 200);
const boot = (await call(env, "bootstrap?company=logia-services")).body.documents.find((d) => d.id === inv.id);
ok("list shows paid amount", boot.paid_cents === 10000 && boot.source === "app");
r = await call(env, "documents/" + inv.id + "/payments/" + r.body.payments[1].id, "DELETE");
ok("payment removed (kept, marked void)", r.status === 200 && r.body.payments.filter((p) => !p.voided_at).length === 1);

// F08: clearing a password (reset) ends existing sessions
db.db.prepare("UPDATE users SET password_hash=NULL WHERE id=1").run();
ok("session invalid after password reset", (await call(env, "bootstrap")).status === 401);

// F02: restore needs the RESTORE_CODE secret, not just a password inside the uploaded file
const blank = new DB();
const forged = { format: "plutus-backup", version: 1, schema: [{ type: "table", name: "users", tbl_name: "users", sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)" }], counts: { users: 0 }, users: [], email: "x", password: "y" };
ok("restore off without RESTORE_CODE even with switch on", (await call(envFor(blank, { RESTORE_ENABLED: "1" }), "restore/begin", "POST", forged, false)).status === 403);
ok("restore refuses wrong code", (await call(envFor(blank, { RESTORE_ENABLED: "1", RESTORE_CODE: "correct-horse-battery" }), "restore/begin", "POST", { ...forged, restoreCode: "guess-guess-guess" }, false)).status === 401);
ok("blank database untouched by refused restores", blank.db.prepare("SELECT COUNT(*) n FROM sqlite_master").get().n === 0);

// Full backup → restore round trip with the correct code still works (needed for the account move)
{
  const src = freshDb(); await session(src);
  const pw = "Synthetic-Password-123";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const h = Buffer.from(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 25000, hash: "SHA-256" }, k, 256)).toString("hex");
  src.db.prepare("UPDATE users SET password_hash=?, password_salt=?, password_iterations=25000 WHERE id=1").run(h, Buffer.from(salt).toString("hex"));
  const senv = envFor(src);
  await call(senv, "documents", "POST", doc); // also creates the payments table and new columns
  const schema = (await call(senv, "backup/schema")).body;
  const tables = {};
  for (const t of schema.order) { const rows = []; let after = 0; for (;;) { const p = (await call(senv, `backup/rows?table=${t}&after=${after}`)).body; rows.push(...p.rows); if (p.done) break; after = p.last; } tables[t] = rows; }
  const dst = new DB(); const denv = envFor(dst, { RESTORE_ENABLED: "1", RESTORE_CODE: "correct-horse-battery" });
  const begin = await call(denv, "restore/begin", "POST", { format: schema.format, version: schema.version, schema: schema.schema, counts: schema.counts, users: tables.users, email: "info@logia.co.za", password: pw, restoreCode: "correct-horse-battery" }, false);
  ok("restore begins with the right code", begin.status === 200);
  for (const t of begin.body.order) { if (t === "users" || t === "sessions" || !tables[t].length) continue; await call(denv, "restore/rows", "POST", { token: begin.body.token, table: t, rows: tables[t] }, false); }
  const fin = await call(denv, "restore/finish", "POST", { token: begin.body.token }, false);
  ok("restore finishes with matching counts", fin.status === 200 && fin.body.counts.documents === schema.counts.documents && "payments" in fin.body.counts);
}

console.log(`\n${pass} checks passed`);
