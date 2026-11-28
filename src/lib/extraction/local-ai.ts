import { looksMedical } from "../medical";
import { MAX_TEXT_CHARS, type ExtractedInvoice } from "./types";
import { useSyncExternalStore } from "react";

/**
 * Optional "local AI reader". OFF by default. When switched on in Settings, text that the normal on-device reader could
 * not make sense of is sent to /api/ai-audit, which talks only to an Ollama model on the same computer (localhost:11434).
 * Medical documents are never sent (a GDPR/HIPAA review has not been done), and the server refuses any non-local request.
 */
const KEY = "overbill:local-ai";
const listeners = new Set<() => void>();

export const isLocalAiOn = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export function setLocalAi(on: boolean) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage blocked: stays off */ } listeners.forEach((l) => l()); }
export const useLocalAi = (): boolean => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, isLocalAiOn, () => false);

/** True when this text looks like a health document. Those never go to the AI reader. */
export const isMedicalText = (text: string): boolean => looksMedical("", [text]) || /\b(patient|diagnos\w*|cpt|icd-?10|explanation of benefits|eob|ziekenhuis|zorgverzekering|huisarts|tandarts)\b/i.test(text);

export async function localAiStatus(): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch("/api/ai-audit", { method: "GET", cache: "no-store" });
    const j = (await r.json()) as { ok?: boolean; message?: string };
    return { ok: Boolean(j.ok), message: j.message ?? "" };
  } catch { return { ok: false, message: "Couldn't reach the app's local AI helper." }; }
}

export class LocalAiSkipped extends Error {}

export async function localAiExtract(text: string): Promise<ExtractedInvoice> {
  if (isMedicalText(text)) throw new LocalAiSkipped("This looks like a medical document, so it was not sent to the AI reader. Paste the lines in the format “description | quantity | unit price | total” or use a CSV.");
  const r = await fetch("/api/ai-audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text.slice(0, MAX_TEXT_CHARS), fileType: "text" }) });
  const j = (await r.json().catch(() => ({}))) as ExtractedInvoice & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "The local AI reader failed.");
  return j;
}
