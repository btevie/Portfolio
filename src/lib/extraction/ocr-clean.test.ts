import { describe, expect, it } from "vitest";
import { cleanOcrLines, diagnoseOcr, fixAmountDigits, scoreOcr } from "./ocr-clean";
import { looseRead } from "./loose";

describe("OCR repair", () => {
  it("repairs look-alike characters inside amounts only", () => {
    expect(fixAmountDigits("Total 1O5.5O")).toBe("Total 105.50");
    expect(fixAmountDigits("Hosting 12l.S0")).toBe("Hosting 121.50");
    expect(fixAmountDigits("SOLID BOSS 12.50")).toBe("SOLID BOSS 12.50");
  });
  it("closes spaces inside decimals and fixes a misread euro sign", () => {
    expect(cleanOcrLines(["Total 12 .50"])).toEqual(["Total 12.50"]);
    expect(cleanOcrLines(["Total E45,00"])).toEqual(["Total €45,00"]);
  });
  it("scores a real invoice far above noise", () => {
    expect(scoreOcr("Invoice 123\nTotal 45.00\nVAT 9.45\nAmount due 54.45")).toBeGreaterThan(scoreOcr("~~ ^^ ¬¬ ¦¦ §§ ©©"));
  });
  it("explains why a read failed", () => {
    expect(diagnoseOcr("", { width: 400, height: 300 }).message).toMatch(/small/);
    expect(diagnoseOcr("", { width: 3000, height: 2000, contrast: 20 }).message).toMatch(/dark/);
    expect(diagnoseOcr("Total 10.00").ok).toBe(true);
  });
});

describe("medical bills", () => {
  const text = "City Hospital\nStatement date 03/11/2026\n99213 Office visit 150.00\n85025 Blood count 40.00\nInsurance adjustment 60.00\nPatient responsibility 130.00";
  it("keeps procedure codes out of quantities and finds the patient balance", () => {
    const r = looseRead(text, "USD");
    expect(r.lines.map((l) => l.total)).toEqual(["150.00", "40.00"]);
    expect(r.lines.every((l) => l.quantity === "1")).toBe(true);
    expect(r.total).toBe("130.00");
    expect(r.discounts).toBe("60.00");
  });
});

import { parseText } from "./parsers";
describe("two labelled dates on one line", () => {
  it("reads invoice and due date separately", () => {
    const r = parseText("Vendor: Acme\nInvoice No: A-1\nInvoice date: 2026-11-12   Due date: 2026-11-26\nHosting | 1 | 10.00 | 10.00\nTotal: 10.00", "EUR");
    expect(r.date).toBe("2026-11-12");
    expect(r.dueDate).toBe("2026-11-26");
  });
});
