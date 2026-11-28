/**
 * Passphrase-protected backup files. The key is derived from the passphrase with PBKDF2 and the data is sealed with
 * AES-GCM, all inside the browser. There is no recovery: a forgotten passphrase means the backup cannot be opened.
 */
const ITERATIONS = 600_000;
const MAGIC = "overbill-encrypted-backup";

const b64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export const MIN_PASSPHRASE = 10;

export async function encryptBackup(json: string, passphrase: string): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(passphrase, salt, ITERATIONS), new TextEncoder().encode(json)));
  return JSON.stringify({ format: MAGIC, version: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(sealed) });
}

/** Returns the original JSON, or throws a message safe to show the user. */
export async function decryptBackup(file: string, passphrase: string): Promise<string> {
  let parsed: { format?: string; iterations?: number; salt?: string; iv?: string; data?: string };
  try { parsed = JSON.parse(file); } catch { throw new Error("This isn't an Overbill encrypted backup."); }
  if (parsed.format !== MAGIC || !parsed.salt || !parsed.iv || !parsed.data) throw new Error("This isn't an Overbill encrypted backup.");
  // As in earlier versions: a missing or out-of-range count means the default, and a huge count in a hostile file is never honoured.
  const iterations = Number.isInteger(parsed.iterations) && parsed.iterations! >= 100_000 && parsed.iterations! <= 5_000_000 ? parsed.iterations! : ITERATIONS;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parsed.iv) as BufferSource }, await key(passphrase, unb64(parsed.salt), iterations), unb64(parsed.data) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong passphrase, or the file has been changed.");
  }
}
