import { describe, expect, it } from "vitest";
import { isMedicalText } from "./local-ai";

describe("local AI medical exclusion", () => {
  it("blocks health documents", () => {
    expect(isMedicalText("City Hospital\nPatient responsibility 130.00\n99213 Office visit")).toBe(true);
    expect(isMedicalText("Tandarts Jansen\nControle 45,00")).toBe(true);
    expect(isMedicalText("Explanation of Benefits\nClaim 123")).toBe(true);
  });
  it("lets ordinary bills through", () => {
    expect(isMedicalText("Northwind Hosting\nDedicated server 149.00\nTotal 192.38")).toBe(false);
  });
});
