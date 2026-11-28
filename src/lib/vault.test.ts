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
  it("still opens a backup made with an older, shorter passphrase and fewer iterations", async () => {
    const pass = "oldpass8"; // 8 characters: shorter than today's minimum, which only applies when making a backup
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    const k = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(data)));
    const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
    const legacy = JSON.stringify({ format: "overbill-encrypted-backup", version: 1, kdf: "PBKDF2-SHA256", iterations: 200_000, salt: b64(salt), iv: b64(iv), data: b64(sealed) });
    expect(await decryptBackup(legacy, pass)).toBe(data);
    const { decryptBackup: viaWrapper } = await import("./crypto-backup");
    expect(await viaWrapper(legacy, pass)).toBe(data);
    expect(await viaWrapper(legacy, "wrongpass")).toBeNull();
  });
  it("opens a backup whose iteration count is missing, using the default it was made with", async () => {
    const file = JSON.parse(await encryptBackup(data, "correct horse battery"));
    delete file.iterations;
    expect(await decryptBackup(JSON.stringify(file), "correct horse battery")).toBe(data);
  });
});
