import { decryptBackup as open, encryptBackup as seal, MIN_PASSPHRASE } from "./vault";

/**
 * Thin wrapper over `vault.ts`, the single implementation of passphrase-encrypted backups (AES-256-GCM, PBKDF2-SHA-256,
 * all in the browser). Files made by either screen open on the other. A lost passphrase cannot be recovered.
 */
export { MIN_PASSPHRASE };
export const encryptBackup = seal;

export function isEncryptedBackup(raw: string): boolean {
  try { const x = JSON.parse(raw); return x !== null && typeof x === "object" && x.format === "overbill-encrypted-backup"; } catch { return false; }
}

/** Returns the original text, or null when the passphrase is wrong or the file was changed. */
export async function decryptBackup(raw: string, passphrase: string): Promise<string | null> {
  try { return await open(raw, passphrase); } catch { return null; }
}
