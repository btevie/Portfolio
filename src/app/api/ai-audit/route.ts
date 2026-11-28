import { NextRequest, NextResponse } from "next/server";
import { aiExtractInvoice } from "@/billAuditor";
import { isMedicalText } from "@/lib/extraction/medical-text";
import { MAX_TEXT_CHARS } from "@/lib/extraction/types";

/**
 * Local-only AI reading. It calls an Ollama model on this same computer. If the app is ever served from somewhere else
 * (a remote host), "localhost" would be that host and not the person's own machine, so every request is refused unless
 * the app itself is being opened on localhost.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const isLocal = (req: NextRequest) => LOCAL_HOST.test(req.headers.get("host") ?? "");
const refuse = () => NextResponse.json({ ok: false, error: "The local AI reader only works when Overbill is opened on this computer (localhost).", message: "Only available when Overbill runs on this computer." }, { status: 403 });

export async function GET(req: NextRequest) {
  if (!isLocal(req)) return refuse();
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    const j = (await r.json()) as { models?: { name: string }[] };
    const has = (j.models ?? []).some((m) => m.name.startsWith("llama3.2"));
    return NextResponse.json({ ok: has, message: has ? "Ollama is running with llama3.2." : "Ollama is running, but the model is missing. Run: ollama pull llama3.2" });
  } catch {
    return NextResponse.json({ ok: false, message: "Ollama isn't running on this computer. Install it from ollama.com, then run: ollama pull llama3.2" });
  }
}

export async function POST(req: NextRequest) {
  if (!isLocal(req)) return refuse();
  try {
    const { content } = (await req.json()) as { content?: unknown };
    if (typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "No bill content provided." }, { status: 400 });
    if (content.length > MAX_TEXT_CHARS) return NextResponse.json({ error: "That text is too long for the AI reader." }, { status: 413 });
    // Health documents are excluded until a GDPR/HIPAA review is done: checked again here so no caller can bypass the page.
    if (isMedicalText(content)) return NextResponse.json({ error: "Medical documents are not read by the AI reader." }, { status: 422 });
    const extracted = await aiExtractInvoice(content, "text");
    if (!extracted) return NextResponse.json({ error: "The AI reader couldn't make sense of that bill." }, { status: 502 });
    if (extracted.medical) return NextResponse.json({ error: "That looks like a medical document, so the AI result was discarded." }, { status: 422 });
    return NextResponse.json(extracted);
  } catch (err) {
    console.error("AI extraction failed", err);
    return NextResponse.json({ error: "Couldn't reach the local AI (Ollama). Is it running with the llama3.2 model?" }, { status: 502 });
  }
}
