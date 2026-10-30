import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useApp } from "../App";
import { api, type BankStats, type BankTransaction } from "../data";
import { rand } from "../money";
import { I, Pill } from "../ui";

export default function Banking() {
  const { companyId, notify } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [stats, setStats] = useState<BankStats | null>(null);
  const [openInvoices, setOpenInvoices] = useState<Array<{ id: number; number: string; fromNumber: string | null; customerName: string; openCents: number }>>([]);
  const [activeTab, setActiveTab] = useState<"unmatched" | "all" | "matched" | "ignored">("unmatched");
  const [search, setSearch] = useState("");

  // Import dialog state
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ importedCount: number; skippedCount: number; totalRows: number } | null>(null);

  // Manual invoice selector map: txId -> docId
  const [manualInvoiceMap, setManualInvoiceMap] = useState<Record<number, number>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api<{ transactions: BankTransaction[]; stats: BankStats; openInvoices: any[] }>(
        `bank/transactions?company=${encodeURIComponent(companyId)}`
      );
      setTransactions(res.transactions);
      setStats(res.stats);
      setOpenInvoices(res.openInvoices ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string") {
        setCsvText(content);
      }
    };
    reader.readAsText(file);
  };

  const submitImport = async () => {
    if (!csvText.trim()) {
      notify("Please select or paste an FNB CSV file.");
      return;
    }
    try {
      setImporting(true);
      const res = await api<{ statementId: number; importedCount: number; skippedCount: number; totalRows: number }>(
        "bank/import",
        {
          method: "POST",
          body: {
            companyId,
            filename: fileName || "fnb_statement.csv",
            csvContent: csvText,
          },
        }
      );
      setImportResult(res);
      notify(`Imported ${res.importedCount} transactions (${res.skippedCount} duplicates skipped).`);
      await loadData();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleMatch = async (tx: BankTransaction, customDocId?: number) => {
    const docId = customDocId ?? manualInvoiceMap[tx.id] ?? tx.suggestion?.documentId;
    if (!docId) {
      notify("Select an open invoice to match with this transaction.");
      return;
    }
    try {
      setBusyId(tx.id);
      await api("bank/match", {
        method: "POST",
        body: {
          transactionId: tx.id,
          documentId: docId,
        },
      });
      notify("Transaction reconciled and payment recorded.");
      await loadData();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Matching failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleIgnore = async (txId: number) => {
    try {
      setBusyId(txId);
      await api("bank/ignore", {
        method: "POST",
        body: { transactionId: txId },
      });
      notify("Transaction ignored.");
      await loadData();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to ignore transaction");
    } finally {
      setBusyId(null);
    }
  };

  const handleUnmatch = async (txId: number) => {
    try {
      setBusyId(txId);
      await api("bank/unmatch", {
        method: "POST",
        body: { transactionId: txId },
      });
      notify("Transaction unreconciled and payment reversed.");
      await loadData();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to unmatch");
    } finally {
      setBusyId(null);
    }
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (activeTab === "unmatched") {
        if (tx.status !== "unmatched" || tx.amountCents <= 0) return false;
      } else if (activeTab === "matched") {
        if (tx.status !== "matched") return false;
      } else if (activeTab === "ignored") {
        if (tx.status !== "ignored") return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const mDesc = tx.description.toLowerCase().includes(q);
        const mInv = tx.suggestion?.invoiceNumber.toLowerCase().includes(q);
        const mCust = tx.suggestion?.customerName.toLowerCase().includes(q);
        return mDesc || mInv || mCust;
      }
      return true;
    });
  }, [transactions, activeTab, search]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Bank Reconciliation</h1>
          <p className="sub">Match FNB bank statement deposits to issued invoices and verify customer settlements.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn primary" onClick={() => setShowImport(!showImport)}>
            <I.bank />
            {showImport ? "Close Import" : "Import Statement"}
          </button>
        </div>
      </div>

      {/* Summary KPI Tiles */}
      <div className="tiles" style={{ marginBottom: 20 }}>
        <div className="glass tile span-3 tile-pad">
          <div className="tile-label"><I.alert />Unmatched Deposits</div>
          <div className="tile-value num" style={{ color: "var(--accent)" }}>
            {stats ? rand(stats.unmatched_deposits_cents || 0) : "R 0.00"}
          </div>
          <div className="tile-foot">{stats?.unmatched_deposits_count ?? 0} deposits awaiting match</div>
        </div>
        <div className="glass tile span-3 tile-pad">
          <div className="tile-label"><I.check />Reconciled Total</div>
          <div className="tile-value num" style={{ color: "var(--ok, #4ade80)" }}>
            {stats ? rand(stats.matched_cents || 0) : "R 0.00"}
          </div>
          <div className="tile-foot">{stats?.matched_count ?? 0} matched to invoices</div>
        </div>
        <div className="glass tile span-3 tile-pad">
          <div className="tile-label"><I.bank />Total Statement Rows</div>
          <div className="tile-value num">
            {stats?.total ?? 0}
          </div>
          <div className="tile-foot">Uploaded transactions</div>
        </div>
        <div className="glass tile span-3 tile-pad">
          <div className="tile-label"><I.x />Ignored / Transfers</div>
          <div className="tile-value num" style={{ color: "var(--text-3)" }}>
            {stats?.ignored_count ?? 0}
          </div>
          <div className="tile-foot">Excluded from invoices</div>
        </div>
      </div>

      {/* Import Modal / Drawer */}
      {showImport && (
        <div className="glass tile-pad" style={{ marginBottom: 24, border: "1px solid var(--accent)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Import FNB Statement CSV</h2>
            <button className="btn small ghost" onClick={() => setShowImport(false)}>Close</button>
          </div>
          <p style={{ margin: "0 0 14px", color: "var(--text-2)", fontSize: 14 }}>
            Download your statement from FNB Online Banking as a CSV file. Plutus automatically handles FNB headers, date formats, and deduplicates already imported rows.
          </p>

          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <label className="btn secondary" style={{ cursor: "pointer" }}>
              Choose CSV File
              <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} style={{ display: "none" }} />
            </label>
            <span style={{ fontSize: 13, color: fileName ? "var(--text-1)" : "var(--text-3)" }}>
              {fileName || "No file chosen yet"}
            </span>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--text-2)", marginBottom: 6 }}>
              Or paste CSV data directly:
            </label>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="Date,Amount,Balance,Description..."
              rows={4}
              style={{
                width: "100%",
                background: "rgba(0,0,0,0.25)",
                border: "1px solid var(--hair)",
                borderRadius: 8,
                padding: 10,
                color: "var(--text-1)",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn primary" onClick={submitImport} disabled={importing || !csvText.trim()}>
              {importing ? "Importing & Parsing..." : "Process Statement"}
            </button>
            {importResult && (
              <span style={{ fontSize: 13, color: "var(--ok, #4ade80)" }}>
                ✓ {importResult.importedCount} new rows imported, {importResult.skippedCount} duplicates skipped.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`btn small ${activeTab === "unmatched" ? "primary" : "ghost"}`}
            onClick={() => setActiveTab("unmatched")}
          >
            Needs Action ({stats?.unmatched_deposits_count ?? 0})
          </button>
          <button
            className={`btn small ${activeTab === "all" ? "primary" : "ghost"}`}
            onClick={() => setActiveTab("all")}
          >
            All Transactions ({transactions.length})
          </button>
          <button
            className={`btn small ${activeTab === "matched" ? "primary" : "ghost"}`}
            onClick={() => setActiveTab("matched")}
          >
            Reconciled ({stats?.matched_count ?? 0})
          </button>
          <button
            className={`btn small ${activeTab === "ignored" ? "primary" : "ghost"}`}
            onClick={() => setActiveTab("ignored")}
          >
            Ignored ({stats?.ignored_count ?? 0})
          </button>
        </div>

        <div style={{ position: "relative", minWidth: 260 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description, invoice, customer..."
            style={{
              width: "100%",
              padding: "7px 12px 7px 32px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--hair)",
              borderRadius: 8,
              fontSize: 13,
            }}
          />
          <div style={{ position: "absolute", left: 10, top: 9, pointerEvents: "none", color: "var(--text-3)" }}>
            <I.search width={14} height={14} />
          </div>
        </div>
      </div>

      {/* Transaction List */}
      {loading ? (
        <div className="glass tile-pad" style={{ textAlign: "center", padding: 40, color: "var(--text-3)" }}>
          Loading bank transactions...
        </div>
      ) : error ? (
        <div className="notice"><I.alert /><div><strong>Error</strong><p>{error}</p></div></div>
      ) : filteredTransactions.length === 0 ? (
        <div className="glass tile-pad" style={{ textAlign: "center", padding: 50 }}>
          <p style={{ color: "var(--text-3)", margin: "0 0 14px" }}>
            {activeTab === "unmatched"
              ? "All deposits are reconciled! No open payments awaiting match."
              : "No transactions found matching current filters."}
          </p>
          <button className="btn small secondary" onClick={() => setShowImport(true)}>
            Import FNB Statement
          </button>
        </div>
      ) : (
        <div className="glass" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--hair)", textAlign: "left", color: "var(--text-3)" }}>
                <th style={{ padding: "12px 16px", width: 110 }}>Date</th>
                <th style={{ padding: "12px 16px" }}>Bank Description</th>
                <th style={{ padding: "12px 16px", textAlign: "right", width: 130 }}>Amount</th>
                <th style={{ padding: "12px 16px", width: 340 }}>Reconciliation / Suggestion</th>
                <th style={{ padding: "12px 16px", textAlign: "right", width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => {
                const isDeposit = tx.amountCents > 0;
                const isMatched = tx.status === "matched";
                const isIgnored = tx.status === "ignored";
                const sug = tx.suggestion;

                return (
                  <tr
                    key={tx.id}
                    style={{
                      borderBottom: "1px solid var(--hair)",
                      background: isMatched ? "rgba(74, 222, 128, 0.03)" : isIgnored ? "rgba(255,255,255,0.01)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "14px 16px", verticalAlign: "top", whiteSpace: "nowrap" }} className="num">
                      {tx.date}
                    </td>

                    <td style={{ padding: "14px 16px", verticalAlign: "top" }}>
                      <div style={{ fontWeight: 500, color: "var(--text-1)" }}>{tx.description}</div>
                      {tx.balanceCents !== null && (
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                          Balance: {rand(tx.balanceCents)}
                        </div>
                      )}
                    </td>

                    <td
                      style={{
                        padding: "14px 16px",
                        verticalAlign: "top",
                        textAlign: "right",
                        fontWeight: 600,
                        color: isDeposit ? "var(--ok, #4ade80)" : "var(--text-3)",
                      }}
                      className="num"
                    >
                      {isDeposit ? "+" + rand(tx.amountCents) : rand(tx.amountCents)}
                    </td>

                    <td style={{ padding: "14px 16px", verticalAlign: "top" }}>
                      {isMatched ? (
                        <div>
                          <Pill tone="ok">✓ Reconciled</Pill>
                          <span style={{ fontSize: 12, color: "var(--text-2)", marginLeft: 8 }}>
                            Matched to Invoice #{tx.matchedDocumentId}
                          </span>
                        </div>
                      ) : isIgnored ? (
                        <Pill tone="plain">Ignored (Non-invoice)</Pill>
                      ) : isDeposit ? (
                        <div>
                          {sug ? (
                            <div style={{ marginBottom: 6 }}>
                              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                                <Pill tone={sug.confidence === "high" ? "ok" : "warn"}>
                                  {sug.confidence === "high" ? "High Match" : "Probable"}
                                </Pill>
                                <span style={{ fontWeight: 550, color: "var(--text-1)" }}>
                                  {sug.invoiceNumber}
                                </span>
                                <span style={{ color: "var(--text-2)", fontSize: 12 }}>
                                  • {sug.customerName}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                                {sug.reason} (Open: {rand(sug.openCents)})
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>
                              No automatic match found. Select open invoice:
                            </div>
                          )}

                          {/* Manual invoice selection dropdown */}
                          {openInvoices.length > 0 && (
                            <select
                              value={manualInvoiceMap[tx.id] ?? sug?.documentId ?? ""}
                              onChange={(e) =>
                                setManualInvoiceMap((m) => ({ ...m, [tx.id]: Number(e.target.value) }))
                              }
                              style={{
                                width: "100%",
                                padding: "4px 8px",
                                fontSize: 11,
                                background: "rgba(0,0,0,0.3)",
                                border: "1px solid var(--hair)",
                                borderRadius: 6,
                                color: "var(--text-1)",
                              }}
                            >
                              <option value="">-- Choose different open invoice --</option>
                              {openInvoices.map((inv) => (
                                <option key={inv.id} value={inv.id}>
                                  {inv.number} • {inv.customerName} (Open: {rand(inv.openCents)})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                          Debit / Expense (Non-customer)
                        </span>
                      )}
                    </td>

                    <td style={{ padding: "14px 16px", verticalAlign: "top", textAlign: "right" }}>
                      {isMatched ? (
                        <button
                          className="btn small ghost"
                          onClick={() => handleUnmatch(tx.id)}
                          disabled={busyId === tx.id}
                        >
                          Undo
                        </button>
                      ) : isIgnored ? (
                        <button
                          className="btn small ghost"
                          onClick={() => handleUnmatch(tx.id)}
                          disabled={busyId === tx.id}
                        >
                          Restore
                        </button>
                      ) : isDeposit ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            className="btn small primary"
                            onClick={() => handleMatch(tx)}
                            disabled={busyId === tx.id || (!sug?.documentId && !manualInvoiceMap[tx.id])}
                          >
                            {busyId === tx.id ? "Matching..." : "Match"}
                          </button>
                          <button
                            className="btn small ghost"
                            onClick={() => handleIgnore(tx.id)}
                            disabled={busyId === tx.id}
                            title="Exclude from invoice matching"
                          >
                            Ignore
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn small ghost"
                          onClick={() => handleIgnore(tx.id)}
                          disabled={busyId === tx.id}
                        >
                          Ignore
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
