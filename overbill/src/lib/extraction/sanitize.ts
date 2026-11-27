/**
 * Text that comes from a document or a paste is untrusted. React escapes it when rendering, but invisible and
 * bidirectional control characters can still make one vendor look like another, or reorder what a dispute note says.
 */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F­؜᠎​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function cleanText(s: string, max: number): string {
  return s.normalize("NFC").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
