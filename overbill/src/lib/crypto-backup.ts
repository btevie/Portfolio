/**
 * Passphrase-encrypted backups (AES-256-GCM, key from PBKDF2-SHA-256). Runs entirely in the browser with WebCrypto:
 * the passphrase and the data never leave the device. A lost passphrase cannot be recovered by anyone.
 */
const ITERATIONS = 600_000;
const MARK = "overbill-encrypted-backup";

const b64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function isEncryptedBackup(raw: string): boolean {
  try { const x = JSON.parse(raw); return x !== null && typeof x === "object" && x.format === MARK; } catch { return false; }
}

export async function encryptBackup(plain: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return JSON.stringify({ format: MARK, version: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

/** Returns the original text, or null when the passphrase is wrong or the file was changed. */
export async function decryptBackup(raw: string, passphrase: string): Promise<string | null> {
  try {
    const x = JSON.parse(raw);
    if (x?.format !== MARK || typeof x.salt !== "string" || typeof x.iv !== "string" || typeof x.data !== "string") return null;
    const iterations = Number.isInteger(x.iterations) && x.iterations >= 100_000 && x.iterations <= 5_000_000 ? x.iterations : ITERATIONS;
    const key = await keyFor(passphrase, unb64(x.salt), iterations);
    const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(x.iv) as BufferSource }, key, unb64(x.data) as BufferSource);
    return new TextDecoder().decode(out);
  } catch { return null; }
}
