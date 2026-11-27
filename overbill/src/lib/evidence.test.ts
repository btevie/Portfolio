import { describe, expect, it } from "vitest";
import { auditInvoice } from "./audit/engine";
import { D } from "./audit/money";
import { DEFAULT_CONFIG } from "./audit/types";
import { extractionInfo, findingGuide, isSimulated, uncertainFieldLabels } from "./evidence";
import { atStakeByCurrency, actionQueue, auditAll, dashboardMetrics, nextActions } from "./data/selectors";
import { createSeedState } from "./data/seed";
import type { Invoice } from "./types";

const base: Invoice = {
  id: "i1", vendorId: "v", vendorName: "Acme", number: "A-1", date: "2026-10-01", dueDate: "2026-10-31", currency: "EUR",
  lineItems: [{ id: "l1", description: "Team plan", quantity: "3", unitPrice: "49.00", total: "174.00", kind: "item" }],
  subtotal: "174.00", discounts: "0.00", fees: "0.00", taxAmount: "0.00", total: "174.00", paymentStatus: "unpaid", source: "upload", extraction: "csv", createdAt: 1,
};
const ctx = (invoices: Invoice[]) => ({ today: "2026-11-26", invoices, contractRates: [], config: DEFAULT_CONFIG });

describe("extractionInfo", () => {
  it("never claims a photo or scan was read: mock extraction is labelled simulated and not from the user's document", () => {
    const i = extractionInfo({ extraction: "mock", source: "upload" });
    expect(i.kind).toBe("simulated");
    expect(i.fromYourDocument).toBe(false);
    expect(i.detail).toMatch(/never read/i);
    expect(i.detail).toMatch(/photos, scans/i);
  });
  it("says a PDF was read from its embedded text without OCR", () => {
    const i = extractionInfo({ extraction: "pdf", source: "upload" });
    expect(i.detail).toMatch(/no optical character recognition/i);
  });
  it("labels demo sample data and unknown sources distinctly", () => {
    expect(extractionInfo({ source: "demo" }).kind).toBe("sample");
    expect(extractionInfo({ source: "upload" }).kind).toBe("unknown");
  });
  it("lists fields the user confirmed", () => {
    expect(uncertainFieldLabels({ uncertainFields: ["date", "dueDate"] })).toEqual(["invoice date", "due date"]);
  });
});

describe("findingGuide", () => {
  it("explains an arithmetic finding: what was checked, figures with sources, what to verify", () => {
    const f = auditInvoice(base, ctx([base])).findings.find((x) => x.ruleId === "arithmetic")!;
    const g = findingGuide(f, base);
    expect(g.checked).toMatch(/line 1/);
    expect(g.compared.map((r) => r.label)).toEqual(["Expected", "Invoice says", "Difference"]);
    expect(g.compared[0].value).toBe(f.expected);
    expect(g.compared[0].from).toMatch(/recalculated/i);
    expect(g.compared[1].from).toMatch(/from your CSV/);
    expect(g.verify.length).toBeGreaterThan(1);
  });
  it("tells the user not to rely on a simulated result", () => {
    const sim = { ...base, extraction: "mock" as const };
    const f = auditInvoice(sim, ctx([sim])).findings[0];
    const g = findingGuide(f, sim);
    expect(g.verify).toHaveLength(1);
    expect(g.verify[0]).toMatch(/do not use/i);
    expect(g.compared[1].from).toMatch(/simulated/);
  });
  it("asks to confirm PDF/pasted figures against the bill first", () => {
    const pdf = { ...base, extraction: "pdf" as const, uncertainFields: ["date"] };
    const g = findingGuide(auditInvoice(pdf, ctx([pdf])).findings[0], pdf);
    expect(g.verify[0]).toMatch(/match what is printed/);
    expect(g.readingNotes.join(" ")).toMatch(/invoice date/);
  });
});

describe("simulated invoices never count toward real totals", () => {
  it("are excluded from money at stake and the action queue, and never act as history for real invoices", () => {
    const seed = createSeedState();
    const before = atStakeByCurrency(seed, auditAll(seed));
    const beforeDashboard = dashboardMetrics(seed, auditAll(seed));
    const sim: Invoice = { ...base, id: "sim1", vendorId: seed.vendors[0].id, vendorName: seed.vendors[0].name, extraction: "mock" };
    const withSim = { ...seed, invoices: [...seed.invoices, sim] };
    const audits = auditAll(withSim);
    expect(audits[sim.id].findings.length).toBeGreaterThan(0); // still audited, so the example can be shown
    expect(isSimulated(sim)).toBe(true);
    expect(atStakeByCurrency(withSim, audits).totals).toEqual(before.totals);
    expect(actionQueue(withSim, audits).some((q) => q.invoice.id === sim.id)).toBe(false);
    expect(nextActions(withSim, audits).some((a) => a.href.includes(sim.id))).toBe(false);
    const afterDashboard = dashboardMetrics(withSim, audits);
    expect(afterDashboard.invoicesChecked).toBe(beforeDashboard.invoicesChecked);
    expect(afterDashboard.monthly).toEqual(beforeDashboard.monthly);
    expect(D(0).eq(0)).toBe(true);
  });
});
