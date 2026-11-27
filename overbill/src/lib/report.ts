import { D, formatMoney } from "./audit/money";
import { STATUS_LABEL } from "./format";
import { atStakeByCurrency, type Audits } from "./data/selectors";
import type { AppState, Currency, RecoveryRecord } from "./types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function byCurrency(records: RecoveryRecord[], statuses: string[]): string {
  const m = new Map<Currency, ReturnType<typeof D>>();
  for (const r of records.filter((x) => statuses.includes(x.status))) m.set(r.currency, (m.get(r.currency) ?? D(0)).plus(D(r.amount)));
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
<div class="card ok"><span>Money recovered</span><b>${esc(byCurrency(state.recovery, ["recovered"]))}</b></div>
<div class="card"><span>Credit promised, not yet applied</span><b>${esc(byCurrency(state.recovery, ["credit_issued"]))}</b></div>
<div class="card"><span>Claimed, still open</span><b>${esc(byCurrency(state.recovery, ["flagged", "disputed", "vendor_responded"]))}</b></div>
<div class="card warn"><span>Possible overcharges on unpaid and paid invoices</span><b>${esc(stake)}</b></div>
</div>
<h2 style="font-size:18px">Cases</h2>
${rows ? `<table><thead><tr><th>Vendor</th><th>Case</th><th class="n">Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No cases yet.</p>"}
<p class="note">Amounts are shown per currency and are never converted or added together. &ldquo;Recovered&rdquo; is what you marked as received in Overbill; it is not verified against a bank statement. &ldquo;Possible overcharges&rdquo; are findings from automated checks that you have not confirmed. ${opts.redact ? "" : "This page contains vendor names and amounts."}</p>
</body></html>`;
}
