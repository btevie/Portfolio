"use client";

import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Invoice } from "@/lib/types";

interface AiFinding {
  code?: string;
  overcharge?: number | string;
  reason: string;
  action?: string;
}

const SYS_PROMPT =
  "You are Overbill Audit AI. Inspect the JSON invoice lines for sneaky optional add-ons, vague surcharges, expired promo discounts, duplicate/overlapping coverage, Dutch 9% vs 21% BTW errors, EU B2B reverse-charge issues, healthcare tariff unbundling, or arithmetic errors. Frame everything cautiously as a possible overcharge to verify. Return strict JSON: {\"findings\": [{\"code\": \"...\", \"overcharge\": 0, \"reason\": \"...\", \"action\": \"...\"}], \"clean\": boolean}.";

export function AiSecondOpinionCard({ invoice }: { invoice: Invoice }) {
  const [endpoint, setEndpoint] = useState("http://localhost:11434/v1/chat/completions");
  const [model, setModel] = useState("qwen2.5:7b");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<AiFinding[] | null>(null);

  async function runAiReview() {
    setLoading(true);
    setError(null);
    setFindings(null);
    try {
      const payload = {
        invoice_id: invoice.number,
        vendor: invoice.vendorName,
        currency: invoice.currency,
        subtotal: invoice.subtotal,
        tax: invoice.taxAmount,
        total: invoice.total,
        lines: invoice.lineItems.map((l) => ({
          desc: l.description,
          qty: l.quantity,
          unit: l.unitPrice,
          amount: l.total,
          taxRate: l.taxRate ?? invoice.taxRate,
        })),
      };

      const res = await fetch(endpoint.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
        },
        body: JSON.stringify({
          model: model.trim() || "qwen2.5:7b",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYS_PROMPT },
            { role: "user", content: JSON.stringify(payload) },
          ],
        }),
      });

      if (!res.ok) throw new Error(`Endpoint returned HTTP ${res.status}`);
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw);
      setFindings(Array.isArray(parsed.findings) ? parsed.findings : []);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}. Make sure local Ollama is running (OLLAMA_ORIGINS="*" ollama serve) or check your API key/endpoint.`
          : "Could not reach AI endpoint."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="group mt-6 rounded-2xl border border-line bg-card shadow-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div>
          <p className="text-sm font-semibold">AI second opinion (optional · Local Ollama or BYOK)</p>
          <p className="text-xs text-muted-foreground">Send structured line items to your own local Ollama model or OpenAI-compatible API</p>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-line px-5 py-4">
        <p className="text-xs text-muted-foreground">
          Overbill’s main audit runs 100% locally in your browser without AI. Use this optional check if you want a language model (such as local Ollama or your fine-tuned Overbill model) to inspect unusual wording.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium">
            Endpoint URL
            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
            />
          </label>
          <label className="text-xs font-medium">
            Model name
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="qwen2.5:7b or ft:gpt-4o-mini..."
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
            />
          </label>
          <label className="text-xs font-medium">
            API key (optional for Ollama)
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-... (never saved)"
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={runAiReview} disabled={loading}>
            <Sparkles className="mr-1.5 size-3.5" aria-hidden />
            {loading ? "Analyzing invoice…" : "Run AI second opinion"}
          </Button>
          {error && <p role="alert" className="text-xs text-bad">{error}</p>}
        </div>

        {findings !== null && (
          <div className="rounded-xl border border-line bg-canvas p-4">
            {findings.length === 0 ? (
              <p className="text-sm font-medium text-ok">AI review found no additional anomalies to verify.</p>
            ) : (
              <ul className="space-y-3">
                {findings.map((f, idx) => (
                  <li key={idx} className="rounded-lg border border-line bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{f.code || "AI Observation"}</span>
                      <span className="rounded-full border border-warn/30 bg-warn-bg px-2.5 py-0.5 text-xs font-medium text-warn">
                        Possible overcharge to verify
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{f.reason}</p>
                    {f.action && <p className="mt-1.5 text-xs font-medium">Suggested check: {f.action}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
