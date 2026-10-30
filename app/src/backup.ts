// Backup download and restore upload (see worker/backup.ts).
import { api } from "./data";

type SchemaRow = { type: "table" | "index"; name: string; tbl_name: string; sql: string | null };
export type Backup = {
  format: "plutus-backup"; version: 1; createdAt: string; source: string;
  schema: SchemaRow[]; order: string[]; counts: Record<string, number>; emptyTables: string[];
  tables: Record<string, Record<string, unknown>[]>;
};
type Progress = (text: string) => void;

/** Reads every table page by page and returns the complete backup, after checking the row counts. */
export async function buildBackup(progress: Progress): Promise<Backup> {
  const head = await api<Omit<Backup, "tables">>("backup/schema");
  const tables: Backup["tables"] = {};
  for (const t of head.order) {
    const rows: Record<string, unknown>[] = [];
    let after = 0;
    for (;;) {
      const page = await api<{ rows: Record<string, unknown>[]; last: number | null; done: boolean }>(`backup/rows?table=${encodeURIComponent(t)}&after=${after}`);
      rows.push(...page.rows);
      progress(`Reading ${t}: ${rows.length} of ${head.counts[t]}`);
      if (page.done || page.last === null) break;
      after = page.last;
    }
    if (rows.length !== head.counts[t]) throw new Error(`${t}: expected ${head.counts[t]} rows, read ${rows.length}. Nothing was saved; try again.`);
    tables[t] = rows;
  }
  return { ...head, tables };
}

export function saveFile(b: Backup) {
  const blob = new Blob([JSON.stringify(b)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `plutus-backup-${b.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const CHUNK = 150;

/** Restores a backup file into a blank Plutus. */
export async function restoreBackup(b: Backup, email: string, password: string, restoreCode: string, progress: Progress) {
  if (b?.format !== "plutus-backup" || b.version !== 1) throw new Error("This is not a Plutus backup file.");
  for (const t of b.order) if ((b.tables[t]?.length ?? 0) !== b.counts[t]) throw new Error(`The file looks incomplete (${t}). Download the backup again.`);
  progress("Checking your password and creating the tables…");
  const begin = await api<{ token: string; order: string[] }>("restore/begin", { method: "POST", body: { format: b.format, version: b.version, schema: b.schema, counts: b.counts, users: b.tables.users ?? [], email, password, restoreCode } });
  for (const t of begin.order) {
    if (t === "users" || b.emptyTables.includes(t)) continue;
    const rows = b.tables[t] ?? [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      await api("restore/rows", { method: "POST", body: { token: begin.token, table: t, rows: rows.slice(i, i + CHUNK) } });
      progress(`Restoring ${t}: ${Math.min(i + CHUNK, rows.length)} of ${rows.length}`);
    }
  }
  progress("Checking every table…");
  return await api<{ ok: boolean; counts: Record<string, number> }>("restore/finish", { method: "POST", body: { token: begin.token, source: b.source } });
}
