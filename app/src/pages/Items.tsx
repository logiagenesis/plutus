import { useMemo, useState } from "react";
import { data } from "../data";
import { rand } from "../money";
import { I, Pill, Empty } from "../ui";
import { go, useApp } from "../App";

export default function Items() {
  const { rev } = useApp();
  const [q, setQ] = useState("");
  const cats = useMemo(() => [...new Set(data.items.map((i) => i.category ?? "Other"))].sort(), [rev]);
  const [cat, setCat] = useState("all");
  const rows = data.items
    .filter((i) => (cat === "all" || (i.category ?? "Other") === cat) && (!q || `${i.description} ${i.code ?? ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.description.localeCompare(b.description));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Items and services</h1><p className="sub">Your price list. Picking one on an invoice fills in the price.</p></div><a className="btn primary" href="#/items/new"><I.plus />Add item</a></div>
      <section className="glass panel">
        <div className="panel-head">
          <div className="toolbar" style={{ flex: 1 }}>
            <label className="search" style={{ flex: "1 1 240px", maxWidth: 380 }}><I.search /><input className="input" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" /></label>
            <div className="seg" role="group" aria-label="Category">
              <button aria-pressed={cat === "all"} onClick={() => setCat("all")}>All</button>
              {cats.map((c) => <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
            </div>
          </div>
          <span className="muted">{rows.length} shown</span>
        </div>
        {rows.length === 0 ? <Empty title="No items match" /> : (
          <div className="table-wrap"><table className="grid">
            <thead><tr><th>Item</th><th className="hide-xs">Category</th><th className="hide-sm">Unit</th><th className="r">Price (excl.)</th></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.sageId} className="row" tabIndex={0} onClick={() => go(`/items/${i.sageId}`)} onKeyDown={(e) => e.key === "Enter" && go(`/items/${i.sageId}`)}>
                <td><div className="strong">{i.description}</div><div className="cell-sub">{i.code}{!i.active && <> · <Pill tone="plain">Inactive</Pill></>}</div></td>
                <td className="hide-xs muted">{i.category ?? "—"}</td>
                <td className="hide-sm muted">{i.unit ?? "—"}</td>
                <td className="r num strong">{i.priceExclCents ? rand(i.priceExclCents) : <span className="faint">Set on invoice</span>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
