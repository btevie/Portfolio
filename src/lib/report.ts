import { D, formatMoney } from "./audit/money";
import { STATUS_LABEL } from "./format";
import { atStakeByCurrency, type Audits } from "./data/selectors";
import { caseFigures } from "./recovery";
import type { AppState, Currency, RecoveryRecord } from "./types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function byCurrency(records: RecoveryRecord[], include: (r: RecoveryRecord) => boolean, amount: (r: RecoveryRecord) => ReturnType<typeof D>): string {
  const m = new Map<Currency, ReturnType<typeof D>>();
  for (const r of records.filter(include)) {
    const value = amount(r);
    if (value.gt(0)) m.set(r.currency, (m.get(r.currency) ?? D(0)).plus(value));
  }
  return [...m.entries()].map(([c, v]) => formatMoney(v, c)).join(" · ") || "—";
}

/**
 * A standalone, printable "savings so far" page. Open it, then Print or Save as PDF. It contains vendor names and amounts,
 * so `redact` swaps vendor names for "Vendor 1, 2…" for sharing with someone who should not see them.
 */
export function savingsReportHtml(state: AppState, audits: Audits, opts: { redact?: boolean; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const names = new Map<string, string>();
  const vendor = (id: string, name: string) => opts.redact ? (names.get(id) ?? (names.set(id, `Vendor ${names.size + 1}`), names.get(id)!)) : name;
  const stake = atStakeByCurrency(state, audits).totals.map((t) => formatMoney(t.amount, t.currency)).join(" · ") || "—";
  const moneyRecovered = byCurrency(state.recovery, (r) => r.status !== "dismissed", (r) => caseFigures(r).resolved);
  const pendingCredit = byCurrency(state.recovery, (r) => r.status === "credit_issued", (r) => caseFigures(r).outstanding);
  const stillOpen = byCurrency(state.recovery, (r) => ["flagged", "disputed", "vendor_responded"].includes(r.status), (r) => {
    const f = caseFigures(r);
    return f.claimed.minus(f.resolved).gt(0) ? f.claimed.minus(f.resolved) : D(0);
  });
  const cases = state.recovery.filter((r) => r.status !== "dismissed");
  const rows = cases.map((r) => `<tr><td>${esc(vendor(r.vendorId, r.vendorName))}</td><td>${esc(opts.redact ? "—" : r.title)}</td><td class="n">${esc(formatMoney(r.amount, r.currency))}</td><td>${esc(STATUS_LABEL[r.status] ?? r.status)}</td></tr>`).join("");
  const date = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overbill savings report</title>
<style>
*{box-sizing:border-box}body{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0b1220;margin:0;padding:32px;max-width:820px;margin-inline:auto}
h1{font-size:26px;margin:0 0 4px}.sub{color:#475569;margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:28px}
.card{border:1px solid #e2e8f0;border-radius:16px;padding:16px}.card b{display:block;font-size:24px;margin-top:4px}.card span{color:#475569;font-size:13px}
.ok b{color:#15803d}.warn b{color:#a16207}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0}th{color:#475569;font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums}
.note{color:#64748b;font-size:12px;margin-top:24px}button{font:inherit;padding:10px 18px;border-radius:999px;border:0;background:#15803d;color:#fff;cursor:pointer;margin-bottom:20px}
@media print{button{display:none}body{padding:0}}
</style></head><body>
<button onclick="window.print()">Print or save as PDF</button>
<h1>Savings report</h1><p class="sub">Prepared ${esc(date)} with Overbill${opts.redact ? " · vendor names hidden" : ""}</p>
<div class="grid">
<div class="card ok"><span>Money recovered or applied</span><b>${esc(moneyRecovered)}</b></div>
<div class="card"><span>Promised, still outstanding</span><b>${esc(pendingCredit)}</b></div>
<div class="card"><span>Claimed, still open</span><b>${esc(stillOpen)}</b></div>
<div class="card warn"><span>Possible overcharges on unpaid and paid invoices</span><b>${esc(stake)}</b></div>
</div>
<h2 style="font-size:18px">Cases</h2>
${rows ? `<table><thead><tr><th>Vendor</th><th>Case</th><th class="n">Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No cases yet.</p>"}
<p class="note">Amounts are shown per currency and are never converted or added together. &ldquo;Money recovered or applied&rdquo; is what you recorded in Overbill; it is not verified against a bank statement or vendor account. &ldquo;Possible overcharges&rdquo; are findings from automated checks that you have not confirmed. ${opts.redact ? "" : "This page contains vendor names and amounts."}</p>
</body></html>`;
}
