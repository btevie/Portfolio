import { describe, expect, it } from "vitest";
import { createSeedState } from "../data/seed";
import { activeReminders, auditAll } from "../data/selectors";
import { parseStoredState } from "../data/validate-state";

describe("contract cap and renewal", () => {
  const base = createSeedState();
  const northwind = base.vendors.find((v) => v.name.startsWith("Northwind"))!;
  const withContract = (contract: NonNullable<typeof northwind.contract>) => ({ ...base, vendors: base.vendors.map((v) => (v.id === northwind.id ? { ...v, contract } : v)) });

  it("flags an increase above a cap the user entered as a likely error, with the amount over the cap", () => {
    const s = withContract({ upliftCapPct: "5" });
    const f = Object.values(auditAll(s)).flatMap((a) => a.findings).find((x) => x.ruleId === "price_history" && x.id.endsWith(":cap"));
    expect(f?.classification).toBe("LIKELY_ERROR");
    expect(f?.title).toMatch(/above the 5% cap/);
    expect(Number(f?.amountAtRisk)).toBeGreaterThan(0);
    expect(f?.evidence.join(" ")).toContain("Contract cap you entered: 5%");
  });
  it("does not use the cap path when the increase is within it", () => {
    const s = withContract({ upliftCapPct: "50" });
    expect(Object.values(auditAll(s)).flatMap((a) => a.findings).some((x) => x.id.endsWith(":cap"))).toBe(false);
  });
  it("reminds you before the notice deadline of a renewal, and not for far-off ones", () => {
    const soon = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const r1 = activeReminders(withContract({ renewalDate: soon, noticeDays: 30 }), auditAll(base)).filter((r) => r.kind === "renewal");
    expect(r1).toHaveLength(1);
    expect(r1[0].text).toContain("Decide by");
    expect(activeReminders(withContract({ renewalDate: far, noticeDays: 30 }), auditAll(base)).some((r) => r.kind === "renewal")).toBe(false);
  });
  it("survives a save and reload, and rejects a nonsense contract", () => {
    const s = withContract({ renewalDate: "2027-03-01", noticeDays: 60, upliftCapPct: "7.5" });
    const back = parseStoredState(JSON.stringify(s));
    expect(back?.state.vendors.find((v) => v.id === northwind.id)?.contract).toEqual({ renewalDate: "2027-03-01", noticeDays: 60, upliftCapPct: "7.5" });
    const bad = withContract({ renewalDate: "not-a-date" });
    expect(parseStoredState(JSON.stringify(bad))?.dropped ?? 1).toBeGreaterThan(0);
  });
});
