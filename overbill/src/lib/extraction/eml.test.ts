import { describe, expect, it } from "vitest";
import { parseEml } from "./eml";

const buf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0)).buffer;

describe("parseEml", () => {
  it("reads a plain text invoice email", () => {
    const e = parseEml(buf("From: billing@acme.test\r\nSubject: Invoice A-1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nVendor: Acme\r\nTotal: 10.00\r\n"));
    expect(e.subject).toBe("Invoice A-1");
    expect(e.text).toContain("Vendor: Acme");
    expect(e.pdfs).toHaveLength(0);
  });
  it("finds a base64 PDF attachment inside a multipart message and decodes quoted-printable text", () => {
    const pdf = "%PDF-1.4 fake";
    const msg = [
      "Subject: Your invoice", 'Content-Type: multipart/mixed; boundary="XX"', "", "--XX",
      "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "Total =3D 10.00", "--XX",
      'Content-Type: application/pdf; name="inv.pdf"', "Content-Transfer-Encoding: base64", 'Content-Disposition: attachment; filename="inv.pdf"', "", btoa(pdf), "--XX--", "",
    ].join("\r\n");
    const e = parseEml(buf(msg));
    expect(e.text).toContain("Total = 10.00");
    expect(e.pdfs).toHaveLength(1);
    expect(e.pdfs[0].name).toBe("inv.pdf");
    expect(new TextDecoder().decode(e.pdfs[0].data)).toBe(pdf);
  });
  it("turns an HTML-only email into text", () => {
    const e = parseEml(buf("Content-Type: text/html\r\n\r\n<p>Vendor: Acme</p><style>x{}</style><p>Total: 5.00</p>"));
    expect(e.text).toContain("Vendor: Acme");
    expect(e.text).not.toContain("x{}");
  });
});

describe("parseEml multipart/alternative", () => {
  it("reads the plain part only, so lines are not doubled", () => {
    const msg = ['Content-Type: multipart/alternative; boundary="AA"', "", "--AA", "Content-Type: text/plain", "", "Total: 10.00", "--AA", "Content-Type: text/html", "", "<p>Total: 10.00</p>", "--AA--", ""].join("\r\n");
    const e = parseEml(buf(msg));
    expect(e.text.match(/Total: 10\.00/g)).toHaveLength(1);
  });
});
