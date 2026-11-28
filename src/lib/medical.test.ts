import { describe, expect, it } from "vitest";
import { looksMedical } from "./medical";
import { parseText } from "./extraction/parsers";

describe("looksMedical", () => {
  it("recognises healthcare providers and terms in several languages", () => {
    expect(looksMedical("St. Mary's Hospital", [])).toBe(true);
    expect(looksMedical("Tandartspraktijk De Linde", ["Controle"])).toBe(true);
    expect(looksMedical("Acme", ["Patient consultation", "CPT 99213"])).toBe(true);
    expect(looksMedical("Huisarts Jansen", [])).toBe(true);
    expect(looksMedical("Acme", ["MRI scan", "Insurance adjustment"])).toBe(true);
  });
  it("does not flag ordinary bills", () => {
    expect(looksMedical("Northwind Hosting", ["Server", "Backup add-on"])).toBe(false);
    expect(looksMedical("Car Insurance Co", ["Premium"])).toBe(false);
    expect(looksMedical("Bean There Coffee Co", ["Flat white"])).toBe(false);
  });
});

describe("medical detection reaches the extracted invoice", () => {
  it("marks a pasted hospital bill as medical", () => {
    const e = parseText("City Hospital\nPatient: J Doe\nConsultation 1 | 1 | 120.00 | 120.00\nXray | 1 | 80.00 | 80.00\nTotal: 200.00", "EUR");
    expect(e.medical).toBe(true);
  });
  it("leaves other bills alone", () => {
    expect(parseText("Acme\nWidget | 1 | 5.00 | 5.00\nTotal: 5.00", "EUR").medical).toBeUndefined();
  });
});
