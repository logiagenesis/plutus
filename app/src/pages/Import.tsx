import { useState } from "react";
import { api, data } from "../data";
import { rand } from "../money";
import { I } from "../ui";
import { useApp } from "../App";

type ImportFile = {
  format: string; sourceSha256?: string; companies: any[]; customers: any[]; items: any[];
  recurringTemplates: any[]; invoices: any[]; quotes: any[]; creditNotes: any[];
};
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function sha256(text: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ImportPage() {
  const { reload, notify } = useApp();
  const [file, setFile] = useState<{ name: string; text: string; d: ImportFile; sha: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; step: string } | null>(null);
  const [result, setResult] = useState<any>(null);

  async function pick(f: File | undefined) {
    setErr(null); setResult(null); setFile(null);
    if (!f) return;
    try {
      const text = await f.text();
      const d = JSON.parse(text) as ImportFile;
      if (d.format !== "accounting666-import/1") throw new Error("This isn’t an Accounting666 import file. Choose the file named …Import_Logia-Services_v02.json.");
      setFile({ name: f.name, text, d, sha: await sha256(text) });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function run() {
    if (!file) return;
    const d = file.d;
    const docs = [
      ...d.invoices.map((x) => ({ ...x, kind: "invoice" })),
      ...d.quotes.map((x) => ({ ...x, kind: "quote" })),
      ...d.creditNotes.map((x) => ({ ...x, kind: "credit_note" })),
    ];
    const plan: [string, any[][]][] = [
      ["customers", chunk(d.customers, 60)], ["items", chunk(d.items, 80)],
      ["recurring", chunk(d.recurringTemplates, 8)], ["documents", chunk(docs, 20)],
    ];
    const total = plan.reduce((a, [, c]) => a + c.length, 0) + 2;
    const batchId = `sage-${file.sha.slice(0, 16)}`;
    let done = 0;
    setErr(null);
    try {
      const co = d.companies.find((c) => c.id === "logia-services") ?? {};
      setProgress({ done, total, step: "Starting" });
      await api("import/start", { method: "POST", body: { batchId, sha256: file.sha, company: { ...co, defaultMessage: d.invoices.slice().sort((a: any, b: any) => b.date.localeCompare(a.date)).find((x: any) => x.message)?.message ?? null } } });
      setProgress({ done: ++done, total, step: "Starting" });
      for (const [part, chunks] of plan) {
        for (const rows of chunks) {
          setProgress({ done, total, step: part });
          await api(`import/${part}`, { method: "POST", body: { batchId, rows } });
          setProgress({ done: ++done, total, step: part });
        }
      }
      const counts = { customers: d.customers.length, items: d.items.length, recurring: d.recurringTemplates.length, invoices: d.invoices.length, quotes: d.quotes.length, creditNotes: d.creditNotes.length };
      await api("import/finish", { method: "POST", body: { batchId, counts } });
      setProgress({ done: total, total, step: "Checking" });
      const s = await api<any>("stats");
      setResult({ s, expected: { ...counts, lines: docs.reduce((a, x) => a + x.lines.length, 0), invoiceTotal: d.invoices.reduce((a: number, x: any) => a + x.totalCents, 0) } });
      await reload();
      notify("Import finished");
    } catch (e) { setErr(`Stopped at step “${progress?.step ?? ""}”: ${e instanceof Error ? e.message : String(e)}. It’s safe to run the import again — nothing is duplicated.`); }
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;
  const inv = result?.s.documents.find((x: any) => x.kind === "invoice");
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <a className="crumb" href="#/settings"><I.back />Settings</a>
      <div className="page-head"><div><h1>Import from Sage</h1><p className="sub">Loads customers, items, recurring invoices, invoices and quotes into {data.companies.find((c) => c.id === "logia-services")?.displayName}. Safe to run twice: anything already imported is skipped.</p></div></div>
      <section className="glass" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <label className="field" htmlFor="imp-file">
          <span>Import file</span>
          <input id="imp-file" type="file" accept=".json,application/json" className="input" style={{ paddingTop: 8 }} onChange={(e) => pick(e.target.files?.[0])} />
          <span className="faint" style={{ fontSize: 12.5 }}>In Drive: Accounting666 › 04_Data › 2026-10-27_Sage_Export › 2026-10-27_Accounting666_Import_Logia-Services_v02.json</span>
        </label>
        {file && (
          <div className="notice info"><I.info /><div>
            <strong>{file.name}</strong>
            <p className="num">{file.d.customers.length} customers · {file.d.items.length} items · {file.d.recurringTemplates.length} recurring · {file.d.invoices.length} invoices · {file.d.quotes.length} quotes · {file.d.creditNotes.length} credit notes</p>
          </div></div>
        )}
        {progress && (
          <div aria-live="polite">
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{pct}% · {progress.step}</div>
          </div>
        )}
        {err && <div className="notice"><I.alert /><div><strong>Import stopped</strong><p>{err}</p></div></div>}
        {result && (
          <div className="notice info"><I.check /><div>
            <strong>Imported. Database now holds:</strong>
            <p className="num">{result.s.customers.n} customers (file: {result.expected.customers}) · {result.s.items.n} items (file: {result.expected.items}) · {result.s.recurring.n} recurring (file: {result.expected.recurring})<br />
              {inv?.n ?? 0} invoices (file: {result.expected.invoices}) · {result.s.documentLines.n} document lines (file: {result.expected.lines})<br />
              Invoice total {rand(inv?.total ?? 0)} (file: {rand(result.expected.invoiceTotal)})</p>
          </div></div>
        )}
        <div><button className="btn primary" disabled={!file || (!!progress && !result && !err)} onClick={run}><I.check />{result ? "Run again" : "Import now"}</button></div>
      </section>
    </div>
  );
}
