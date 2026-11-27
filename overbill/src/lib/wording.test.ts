import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("trust wording", () => {
  it("never calls a result 'all clear' or 'no anomalies' without a guarantee caveat", () => {
    for (const f of ["components/upload-flow.tsx", "components/invoice-list.tsx", "components/ui/index.tsx", "components/dashboard.tsx"]) {
      const s = read(f);
      expect(s, f).not.toMatch(/All clear|No anomalies flagged|No anomaly found/);
    }
    expect(read("components/ui/index.tsx")).toContain("not a guarantee");
  });
  it("keeps the upload check count in step with the engine", () => {
    const up = read("components/upload-flow.tsx");
    const listed = up.match(/const CHECKS = \[([\s\S]*?)\];/)![1].split(",").length;
    expect(listed).toBe(8);
    expect(up).toContain("Running 8 checks");
  });
  it("labels recovery money as claimed until marked received", () => {
    expect(read("components/recovery.tsx")).toContain("Not money in hand");
  });
});
