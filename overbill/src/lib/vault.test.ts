import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup } from "./vault";

describe("encrypted backup", () => {
  const data = JSON.stringify({ version: 1, secret: "Acme owes €1,234.56" });
  it("round-trips with the right passphrase and hides the content", async () => {
    const file = await encryptBackup(data, "correct horse battery");
    expect(file).not.toContain("Acme");
    expect(file).not.toContain("1,234.56");
    expect(await decryptBackup(file, "correct horse battery")).toBe(data);
  });
  it("refuses a wrong passphrase, a tampered file and a non-backup", async () => {
    const file = await encryptBackup(data, "correct horse battery");
    await expect(decryptBackup(file, "wrong passphrase!")).rejects.toThrow(/Wrong passphrase/);
    const t = JSON.parse(file); t.data = t.data.slice(0, -6) + "AAAAAA";
    await expect(decryptBackup(JSON.stringify(t), "correct horse battery")).rejects.toThrow(/Wrong passphrase|changed/);
    await expect(decryptBackup("{}", "x")).rejects.toThrow(/isn't an Overbill/);
    await expect(decryptBackup("nope", "x")).rejects.toThrow(/isn't an Overbill/);
  });
  it("needs a real passphrase and uses a fresh salt each time", async () => {
    await expect(encryptBackup(data, "short")).rejects.toThrow(/at least/);
    expect(await encryptBackup(data, "correct horse battery")).not.toBe(await encryptBackup(data, "correct horse battery"));
  });
});
