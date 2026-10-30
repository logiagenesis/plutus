import { readFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import assert from "node:assert/strict";

mkdirSync(".test-build", { recursive: true });
try {
  const { build } = await import("esbuild");
  await build({ entryPoints: ["worker/index.ts"], bundle: true, platform: "neutral", format: "esm", outfile: ".test-build/worker.mjs", logLevel: "error" });
} catch {
  const { execSync } = await import("node:child_process");
  execSync("NODE_PATH=/usr/share/nodejs node tests/build-worker.cjs", { stdio: "inherit" });
}
const { default: worker } = await import(new URL("../.test-build/worker.mjs", import.meta.url));

class DatabaseSyncPolyfill {
  constructor(id = Math.random().toString(36).slice(2)) {
    this.dbFile = `/tmp/test_poly_${id}.db`;
    if (existsSync(this.dbFile)) unlinkSync(this.dbFile);
    this.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  }
  _call(act, payload) {
    const p = spawnSync("python3", ["-c", `
import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1], timeout=30.0)
conn.row_factory = sqlite3.Row
act = sys.argv[2]
payload = json.loads(sys.argv[3])

try:
    cur = conn.cursor()
    if act == "exec":
        conn.executescript(payload["sql"])
        conn.commit()
        print(json.dumps({"ok": True}))
    elif act == "run":
        cur.execute(payload["sql"], payload.get("args", []))
        conn.commit()
        print(json.dumps({"ok": True, "changes": cur.rowcount}))
    elif act == "get":
        cur.execute(payload["sql"], payload.get("args", []))
        r = cur.fetchone()
        conn.commit()
        print(json.dumps({"ok": True, "res": dict(r) if r else None}))
    elif act == "all":
        cur.execute(payload["sql"], payload.get("args", []))
        rows = cur.fetchall()
        print(json.dumps({"ok": True, "res": [dict(r) for r in rows]}))
    elif act == "batch":
        conn.execute("BEGIN")
        res = []
        for s in payload["statements"]:
            cur.execute(s["sql"], s.get("args", []))
            rows = cur.fetchall()
            n = conn.execute("SELECT changes() AS n").fetchone()[0]
            res.append({"results": [dict(r) for r in rows], "meta": {"changes": n}})
        conn.execute("COMMIT")
        print(json.dumps({"ok": True, "res": res}))
except Exception as e:
    try: conn.execute("ROLLBACK")
    except: pass
    print(json.dumps({"ok": False, "err": str(e)}))
`, this.dbFile, act, JSON.stringify(payload)], { encoding: "utf8" });
    if (p.error) throw p.error;
    if (p.status !== 0) throw new Error(p.stderr || p.stdout);
    const res = JSON.parse(p.stdout);
    if (!res.ok) throw new Error(res.err);
    return res;
  }
  exec(sql) { this._call("exec", { sql }); }
  prepare(sql) {
    const self = this;
    return {
      run(...args) { return { changes: self._call("run", { sql, args }).changes }; },
      get(...args) { return self._call("get", { sql, args }).res; },
      all(...args) { return self._call("all", { sql, args }).res; }
    };
  }
}

class DB {
  constructor() { this.db = new DatabaseSyncPolyfill(); this.barrier = null; }
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
    const statements = st.map((s) => ({ sql: s.sql, args: s.args }));
    const r = this.db._call("batch", { statements });
    return r.res;
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

// Piece 2: Outbound emailing
ok("emailing a draft is refused", (await call(env, "documents/" + (await call(env, "documents", "POST", doc)).body.id + "/send", "POST", { toEmail: "client@example.com" })).status === 400);
ok("emailing requires valid recipient email", (await call(env, "documents/" + inv.id + "/send", "POST", { toEmail: "invalid-email" })).status === 400);
r = await call(env, "documents/" + inv.id + "/send", "POST", { toEmail: "client@example.com", ccEmail: "accounts@logia.co.za" });
ok("email sent, recorded in history and document state updated", r.status === 200 && r.body.emails.length === 1 && r.body.sent_to === "client@example.com" && !!r.body.sent_at);

// Piece 3: Automated Recurring Batch
db.db.exec("INSERT INTO recurring_templates (company_id, customer_id, frequency, start_date, active, exclusive_cents, tax_cents, total_cents) VALUES ('logia-services', 1, 'monthly', '2026-01-25', 1, 1000, 0, 1000)");
const tmplId = db.db.prepare("SELECT last_insert_rowid() AS id").get().id;
db.db.exec(`INSERT INTO recurring_lines (template_id, line_no, description, quantity, unit_price_excl_cents, exclusive_cents, tax_cents, total_cents) VALUES (${tmplId}, 1, 'Monthly Service', '1', 1000, 1000, 0, 1000)`);

let prev = await call(env, "recurring/preview?company=logia-services&date=2026-11-25");
ok("recurring preview shows due template", prev.status === 200 && prev.body.dueCount === 1 && prev.body.projectedTotalCents === 1000);

let recRun = await call(env, "recurring/run", "POST", { companyId: "logia-services", date: "2026-11-25" });
ok("recurring run generates invoice", recRun.status === 200 && recRun.body.generatedCount === 1 && recRun.body.invoices.length === 1);

let recRunAgain = await call(env, "recurring/run", "POST", { companyId: "logia-services", date: "2026-11-25" });
ok("re-running recurring batch in same month skips existing (0 duplicates)", recRunAgain.status === 200 && recRunAgain.body.generatedCount === 0 && recRunAgain.body.skippedCount === 1);

// Piece 4: FNB Bank Statement CSV Reconciliation
const issued = (await call(env, "documents/" + inv.id)).body;
const sampleCsv = `Date,Amount,Balance,Description
2026/10/25,60.00,10500.00,EFT PAYMENT ${issued.number} LOGIA
2026/10/26,60.00,10560.00,DEP FROM RENAMED
2026/10/27,-50.00,10510.00,SERVICE FEES
`;

let bankImp = await call(env, "bank/import", "POST", { companyId: "logia-services", filename: "fnb_oct_2026.csv", csvContent: sampleCsv });
ok("bank statement imports valid rows", bankImp.status === 200 && bankImp.body.importedCount === 3 && bankImp.body.skippedCount === 0);

let bankImpDup = await call(env, "bank/import", "POST", { companyId: "logia-services", filename: "fnb_oct_2026.csv", csvContent: sampleCsv });
ok("re-importing same statement skips duplicate transactions", bankImpDup.status === 200 && bankImpDup.body.importedCount === 0 && bankImpDup.body.skippedCount === 3);

let bankList = await call(env, "bank/transactions?company=logia-services");
ok("bank transactions list returns imported deposits with suggestions", bankList.status === 200 && bankList.body.transactions.length >= 3);

const tx1 = bankList.body.transactions.find((t) => t.description.includes(issued.number));
ok("exact invoice reference matched with high confidence", !!tx1 && tx1.suggestion?.documentId === inv.id && tx1.suggestion?.confidence === "high");

let matchRes = await call(env, "bank/match", "POST", { transactionId: tx1.id, documentId: inv.id });
ok("bank transaction matched and payment recorded on invoice", matchRes.status === 200 && matchRes.body.ok === true);

// Verify invoice is now paid
let docAfterPay = await call(env, "documents/" + inv.id);
const totalPaidAfter = docAfterPay.body.payments.filter((p) => !p.voided_at).reduce((a, p) => a + p.amount_cents, 0);
ok("invoice open balance reflects payment from bank transaction", totalPaidAfter === 10000);

// Verify matching already-paid invoice fails gracefully
const tx2 = bankList.body.transactions.find((t) => t.description.includes("RENAMED"));
let matchOver = await call(env, "bank/match", "POST", { transactionId: tx2.id, documentId: inv.id });
ok("matching already-paid invoice is refused", matchOver.status === 400);

// Unmatch transaction restores open balance
let unmatchRes = await call(env, "bank/unmatch", "POST", { transactionId: tx1.id });
ok("unmatching transaction reverses payment and resets status", unmatchRes.status === 200 && unmatchRes.body.status === "unmatched");

let docAfterUnmatch = await call(env, "documents/" + inv.id);
const totalPaidUnmatch = docAfterUnmatch.body.payments.filter((p) => !p.voided_at).reduce((a, p) => a + p.amount_cents, 0);
ok("invoice open balance restored after unmatch", totalPaidUnmatch === 4000);


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
