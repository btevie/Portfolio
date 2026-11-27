import type { Audits } from "./data/selectors";
import { isOpen } from "./data/selectors";
import { extractionInfo, isSimulated } from "./evidence";
import { RULE_META } from "./audit/engine";
import { safeCsvRow } from "./csv-safe";
import type { AppState } from "./types";

/** Bump when a rule's behaviour changes, so an export says which rules produced it. */
export const RULESET_VERSION = "2026.11";

const HEAD = ["vendor", "invoice_number", "invoice_date", "currency", "invoice_total", "rule", "finding", "expected", "invoice_says", "difference", "possible_overcharge_not_confirmed", "your_decision", "your_reason", "figures_came_from", "evidence"];

/** One row per finding. Simulated (invented) invoices are left out. Amounts stay per row and per currency: nothing is summed. */
export function findingsCsv(state: AppState, audits: Audits): { csv: string; rows: number } {
  const lines = [safeCsvRow(HEAD)];
  for (const inv of state.invoices) {
    if (inv.isCredit || isSimulated(inv)) continue;
    for (const f of audits[inv.id]?.findings ?? []) {
      const decision = state.decisions[f.id] ?? (isOpen(state, f) ? "open" : "resolved in recovery");
      lines.push(safeCsvRow([
        inv.vendorName, inv.number, inv.date, inv.currency, inv.total,
        RULE_META.find((r) => r.id === f.ruleId)?.name ?? f.ruleId, f.title, f.expected, f.actual, f.difference, f.amountAtRisk,
        decision, state.decisionReasons?.[f.id] ?? "", extractionInfo(inv).short, f.evidence.join(" | "),
      ]));
    }
  }
  return { csv: lines.join("\n") + "\n", rows: lines.length - 1 };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A small manifest to ship next to the CSV. The hash shows the file was not changed afterwards. It does not prove who made it. */
export async function buildManifest(csv: string, rows: number, now = new Date()) {
  return JSON.stringify({
    generatedBy: "Overbill", generatedAt: now.toISOString(), rulesetVersion: RULESET_VERSION,
    rules: RULE_META.map((r) => r.id), findings: rows, file: "overbill-findings.csv", sha256: await sha256Hex(csv),
    note: "Findings are possible problems found by arithmetic and comparison checks, not confirmed errors. The hash shows the CSV was not edited after export; it does not prove who produced it.",
  }, null, 2);
}
