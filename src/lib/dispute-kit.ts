import { D, formatMoney } from "./audit/money";
import { RULE_META } from "./audit/engine";
import { fmtDate } from "./format";
import type { AuditFinding, FindingDecision, Invoice, InvoiceLineItem } from "./types";

/**
 * A dispute kit for ONE finding: the message, the invoice and line it is about, the calculation, and the evidence.
 * Nothing here sends anything. Findings are anomalies: the wording stays hedged ("it appears that") until the user
 * has confirmed the finding themselves. All amounts are formatted in the invoice's own currency.
 */
export type DisputeRequest = "explain" | "correct" | "refund";

export const REQUEST_LABEL: Record<DisputeRequest, string> = {
  explain: "Explain this charge",
  correct: "Correct the invoice",
  refund: "Refund this amount",
};

/** What is usually the right ask for each kind of finding. The user can always pick another. */
export function defaultRequest(f: AuditFinding): DisputeRequest {
  switch (f.ruleId) {
    case "arithmetic": case "tax": case "duplicate_line": case "duplicate_invoice": return "correct";
    case "contract_rate": return D(f.amountAtRisk).gt(0) ? "refund" : "correct";
    case "unexpected_fee": return f.id.includes("ADDON_WEEE_DISPOSAL") || f.id.includes("ERR_PREMATURE_COLLECTION") ? "correct" : "explain";
    default: return "explain"; // price history, new fees, dates: first ask what it is
  }
}

/** "Refund this amount" only makes sense when the finding puts money at stake. */
export function availableRequests(f: AuditFinding): DisputeRequest[] {
  return D(f.amountAtRisk).gt(0) ? ["explain", "correct", "refund"] : ["explain", "correct"];
}

export interface KitLine { description: string; quantity: string; unitPrice: string; total: string; kind: "item" | "fee" }

/** The invoice lines a finding is about. Invoice-level findings (duplicates, subtotal, dates) have none. */
export function relatedLines(invoice: Invoice, f: AuditFinding): InvoiceLineItem[] {
  const text = `${f.title}\n${f.evidence.join("\n")}`;
  return invoice.lineItems.filter((l) => f.id.includes(`line-${l.id}`) || f.id.endsWith(`-${l.id}`) || (l.description.length >= 3 && text.includes(`"${l.description}"`)));
}

export interface DisputeKit {
  request: DisputeRequest;
  subject: string;
  message: string;
  /** Invoice facts: label, value. */
  invoiceFacts: [string, string][];
  lines: KitLine[];
  /** The numbers behind the finding. */
  calculation: [string, string][];
  rule: string;
  why: string;
  uncertainty: string;
  evidence: string[];
  /** Amount at stake including tax, formatted, or null when no money is implicated. */
  amountAtStake: string | null;
  confirmed: boolean;
}

function trapSpecificGuidance(f: AuditFinding): string | null {
  if (f.id.includes("cpi-excess")) {
    return "Under Dutch and EU commercial practice, standard annual indexation clauses follow official CBS CPI / EU HICP inflation rates rather than discretionary surcharges above inflation.";
  }
  if (f.id.includes("reverse-charge")) {
    return "As a VAT-registered EU business (B2B), cross-border supplies should be billed at 0% VAT under the EU reverse-charge mechanism (BTW verlegd) with our VAT ID listed on the invoice.";
  }
  if (f.id.includes("nl-vat9")) {
    return "Under Dutch VAT rules (Tabel I Wet OB), food, non-alcoholic catering, books, and passenger transport generally qualify for the reduced 9% BTW rate rather than 21%.";
  }
  if (f.id.includes("ADDON_WEEE_DISPOSAL")) {
    return "Under EU WEEE (AEEA) regulations, retailers delivering a new appliance are required to take back the equivalent old appliance free of charge.";
  }
  if (f.id.includes("MED_UNBUNDLED_HYGIENE")) {
    return "Under Dutch NZa dental tariff regulations, standard hygiene and sterilization costs are already included in the fixed treatment codes.";
  }
  if (f.id.includes("ERR_PREMATURE_COLLECTION")) {
    return "Under the Dutch Collection Costs Act (WIK), a free 14-day payment reminder (14-dagenbrief) must be sent before collection fees can be charged.";
  }
  if (f.id.includes("ADDON_DEVICE_INS") || f.id.includes("ADDON_PAPER_BILL") || f.id.includes("ADDON_SAAS_UPSELL")) {
    return "If this add-on was not explicitly requested, please remove it from our subscription going forward.";
  }
  return null;
}

function requestSentence(request: DisputeRequest, invoice: Invoice, amount: string | null, confirmed: boolean): string {
  const paid = invoice.paymentStatus === "paid";
  const at = amount ? ` of ${amount}` : "";
  const hold = paid ? "" : ` I'll hold payment of the disputed amount until I hear back.`;
  switch (request) {
    case "explain":
      return `Could you please explain what this charge covers and where it is authorised in our agreement or terms? If it is correct, no action is needed.`;
    case "correct":
      return paid
        ? `${confirmed ? "Please" : "If this is a mistake, could you please"} issue a corrected invoice or a credit note${at}.`
        : `${confirmed ? "Please" : "If this is a mistake, could you please"} send a corrected invoice or a credit note${at}.${hold}`;
    case "refund":
      return paid
        ? `Could you please refund or credit${amount ? ` ${amount}` : " the difference"} ${confirmed ? "to me" : "if this charge is not correct"}? I have already paid this invoice, so please tell me how you would like to settle it.`
        : `Could you please credit${amount ? ` ${amount}` : " the difference"} against this invoice${confirmed ? "" : " if this charge is not correct"}?${hold}`;
  }
}

export function buildDisputeKit(invoice: Invoice, f: AuditFinding, decision: FindingDecision | undefined, senderName: string, request: DisputeRequest = defaultRequest(f)): DisputeKit {
  const confirmed = decision === "confirmed";
  const money = (v: string) => formatMoney(v, invoice.currency);
  const amountAtStake = D(f.amountAtRisk).gt(0) ? money(f.amountAtRisk) : null;
  const lines = relatedLines(invoice, f).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: money(l.unitPrice), total: money(l.total), kind: l.kind }));
  const subject = `${confirmed ? "Query on" : "Clarification requested for"} invoice ${invoice.number} (${fmtDate(invoice.date)})`;
  const lineRef = lines.length === 1 ? `, line "${lines[0].description}"` : "";
  const hasCompare = f.expected && f.actual && f.difference && f.difference !== "—";
  const legalNote = trapSpecificGuidance(f);

  const message = [
    `Subject: ${subject}`,
    "",
    `Hello ${invoice.vendorName} team,`,
    "",
    `I'm reviewing invoice ${invoice.number} dated ${fmtDate(invoice.date)} for ${money(invoice.total)}${lineRef}. ${confirmed ? "Our records show" : "It appears that"}: ${f.explanation}`,
    ...(legalNote ? ["", legalNote] : []),
    ...(hasCompare ? ["", `Expected: ${f.expected} · Invoiced: ${f.actual} · Difference: ${f.difference}`] : []),
    ...(amountAtStake ? [`The amount in question is up to ${amountAtStake} including tax.`] : []),
    "",
    requestSentence(request, invoice, amountAtStake, confirmed),
    "",
    "I'm happy to share my records.",
    "Thank you,",
    senderName.trim() || "[Your name]",
  ].join("\n");

  return {
    request, subject, message, lines, amountAtStake, confirmed,
    invoiceFacts: [
      ["Vendor", invoice.vendorName], ["Invoice number", invoice.number], ["Invoice date", fmtDate(invoice.date)], ["Due date", fmtDate(invoice.dueDate)],
      ["Invoice total", money(invoice.total)], ["Currency", invoice.currency],
    ],
    calculation: [
      ["Should be", f.expected], ["Invoice says", f.actual], ["Difference", f.difference],
      ...(amountAtStake ? [["At stake (incl. tax)", amountAtStake] as [string, string]] : []),
    ],
    rule: RULE_META.find((r) => r.id === f.ruleId)?.name ?? f.ruleId,
    why: f.explanation,
    uncertainty: f.uncertainty,
    evidence: f.evidence,
  };
}

/** Everything behind the message as plain text, to paste into an email thread or keep with your records. */
export function kitSummaryText(invoice: Invoice, f: AuditFinding, kit: DisputeKit): string {
  const row = ([k, v]: [string, string]) => `${k}: ${v}`;
  return [
    `Dispute kit: ${f.title}`,
    `Status: ${kit.confirmed ? "confirmed by me" : "automated finding, not confirmed"} (${f.confidence} confidence, ${kit.rule} check)`,
    "",
    "INVOICE", ...kit.invoiceFacts.map(row),
    ...(kit.lines.length ? ["", "LINE", ...kit.lines.map((l) => `${l.description}: ${l.quantity} × ${l.unitPrice} = ${l.total}${l.kind === "fee" ? " (fee)" : ""}`)] : []),
    "", "CALCULATION", ...kit.calculation.map(row), `Why: ${kit.why}`,
    "", `EVIDENCE (amounts in ${invoice.currency})`, ...kit.evidence.map((e) => `- ${e}`),
    "", `NOT CERTAIN: ${kit.uncertainty}`,
  ].join("\n");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A printable one-finding dispute pack: the message (as edited), then the invoice, line, calculation and evidence on one page.
 * Standalone HTML to open and print or save as PDF. It states plainly that the finding is automated and unconfirmed.
 */
export function disputePackHtml(invoice: Invoice, finding: AuditFinding, kit: DisputeKit, message: string, now = new Date()): string {
  const date = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const rows = (pairs: [string, string][]) => pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
  const lines = kit.lines.length
    ? `<table><thead><tr><th>Line</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Total</th></tr></thead><tbody>${kit.lines.map((l) => `<tr><td>${esc(l.description)}${l.kind === "fee" ? " (fee)" : ""}</td><td class="n">${esc(l.quantity)}</td><td class="n">${esc(l.unitPrice)}</td><td class="n">${esc(l.total)}</td></tr>`).join("")}</tbody></table>`
    : `<p>This finding concerns the whole invoice rather than a single line.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dispute pack: invoice ${esc(invoice.number)}</title>
<style>
*{box-sizing:border-box}body{font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#0b1220;margin:0;padding:32px;max-width:780px;margin-inline:auto}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:26px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}.sub{color:#475569;margin:2px 0 18px}
pre{white-space:pre-wrap;font:inherit;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:0}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top}th{color:#475569;font-weight:600;width:34%}thead th{width:auto}.n{text-align:right;font-variant-numeric:tabular-nums}
ul{margin:0;padding-left:20px}.note{color:#64748b;font-size:12px;margin-top:22px}button{font:inherit;padding:10px 18px;border-radius:999px;border:0;background:#15803d;color:#fff;cursor:pointer;margin-bottom:18px}
@media print{button{display:none}body{padding:0}}
</style></head><body>
<button onclick="window.print()">Print or save as PDF</button>
<h1>Dispute pack: invoice ${esc(invoice.number)}</h1>
<p class="sub">${esc(invoice.vendorName)} · prepared ${esc(date)} · request: ${esc(REQUEST_LABEL[kit.request])}</p>
<h2>Message</h2><pre>${esc(message)}</pre>
<h2>Invoice</h2><table><tbody>${rows(kit.invoiceFacts)}</tbody></table>
<h2>${kit.lines.length ? "Line in question" : "Scope"}</h2>${lines}
<h2>Calculation (${esc(kit.rule)} check)</h2><table><tbody>${rows(kit.calculation)}</tbody></table><p>${esc(kit.why)}</p>
<h2>Evidence (amounts in ${esc(invoice.currency)})</h2><ul>${kit.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
<p class="note">This pack comes from an automated check (${esc(finding.confidence)} confidence) and is ${kit.confirmed ? "confirmed by the sender" : "<strong>not a confirmed error</strong>"}. ${esc(kit.uncertainty)} Overbill prepared this document but did not send it.</p>
</body></html>`;
}
