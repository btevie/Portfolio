import type { AuditFinding, Invoice } from "../types";
import { priorInvoices } from "./history";
import { D, formatMoney } from "./money";
import { normalizeDescription } from "./normalize";
import type { AuditContext } from "./types";
import { makeFinding, taxFactor, withTax } from "./rules/util";

function extractFeatures(raw: string): string[] {
  const clean = normalizeDescription(raw)
    .replace(/\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g, "") // strip dates
    .replace(/\b\d+\b/g, "") // strip standalone numbers
    .trim();
  if (!clean) return [];

  const words = clean.split(/\s+/).filter((w) => w.length >= 3);
  const grams: string[] = [...words];
  const padded = `_${clean.replace(/\s+/g, "_")}_`;
  for (let i = 0; i <= padded.length - 3; i++) {
    grams.push(`g:${padded.slice(i, i + 3)}`);
  }
  return grams;
}

function buildTfVector(features: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const f of features) tf.set(f, (tf.get(f) ?? 0) + 1);
  const vec = new Map<string, number>();
  for (const [term, count] of tf.entries()) {
    const w = (1 + Math.log(count)) * (idf.get(term) ?? 1.5);
    vec.set(term, w);
  }
  return vec;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const v of a.values()) normA += v * v;
  for (const v of b.values()) normB += v * v;
  for (const [term, valA] of a.entries()) {
    const valB = b.get(term);
    if (valB !== undefined) dot += valA * valB;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function semanticNoveltyFindings(inv: Invoice, ctx: AuditContext): AuditFinding[] {
  const prior = priorInvoices(inv, ctx);
  if (prior.length < 3 || ctx.vendor?.billing === "variable") return [];

  // Build corpus of historical line descriptions for this vendor
  const docs = prior.flatMap((p) => p.lineItems.map((l) => extractFeatures(l.description))).filter((f) => f.length > 0);
  if (docs.length < 4) return [];

  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const nDocs = docs.length;
  const idf = new Map<string, number>();
  for (const [term, count] of df.entries()) {
    idf.set(term, Math.log((nDocs + 1) / (count + 1)) + 1);
  }

  const histVectors = docs.map((doc) => buildTfVector(doc, idf));
  const out: AuditFinding[] = [];
  const m = (v: string) => formatMoney(v, inv.currency);

  for (const line of inv.lineItems) {
    const amt = D(line.total);
    if (amt.lt(10)) continue; // ignore trivial amounts under 10.00
    const feats = extractFeatures(line.description);
    if (feats.length < 4) continue;

    const lineVec = buildTfVector(feats, idf);
    let maxSim = 0;
    for (const hv of histVectors) {
      const sim = cosineSimilarity(lineVec, hv);
      if (sim > maxSim) maxSim = sim;
    }

    // If max cosine similarity against all historical lines from this vendor is < 0.12, it is lexically alien
    if (maxSim < 0.12) {
      const noveltyPct = Math.round((1 - maxSim) * 100);
      out.push(
        makeFinding(inv, {
          ruleId: "unexpected_fee",
          key: `tfidf-novel-${line.id}`,
          classification: "REVIEW_NEEDED",
          severity: amt.gte(75) ? "medium" : "low",
          title: `Unfamiliar charge label (${noveltyPct}% lexical novelty vs ${inv.vendorName}'s history)`,
          explanation: `"${line.description}" (${m(line.total)}) shares almost no word or character-trigram overlap (${Math.round(maxSim * 100)}% cosine similarity) with any of the ${docs.length} line items ${inv.vendorName} has billed previously.`,
          expected: `Known service/product vocabulary from ${inv.vendorName}`,
          actual: `"${line.description}" (${m(line.total)})`,
          difference: formatMoney(line.total, inv.currency, { signed: true }),
          evidence: [
            `TF-IDF + character trigram cosine similarity: ${Math.round(maxSim * 100)}% (${noveltyPct}% novel)`,
            `Compared against ${docs.length} historical lines across ${prior.length} earlier invoices`,
          ],
          confidence: "medium",
          confidenceReason: "Vector-space TF-IDF and character n-gram comparison against this vendor's historical billing vocabulary.",
          uncertainty: "A legitimate one-off service, renamed SKU, or new product add-on will also score high on lexical novelty.",
          recommendedAction: "Confirm that you ordered or approved this new line item before paying.",
          amountAtRisk: withTax(amt, taxFactor(inv, line.taxRate)),
        })
      );
    }
  }

  return out;
}
