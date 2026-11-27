/**
 * Credit-note tracking: pure functions over `AppState`, so every rule is unit-tested without a browser.
 *
 * Principles
 *  - A credit note is never counted as spend, an amount to pay, or money at stake (callers filter `isCredit`).
 *  - "Issued" is not "received". Settled money is only what the user confirmed with a date and evidence.
 *  - History is append-only. A wrong entry is reversed with a reason; it is never edited or deleted.
 */
import type { AppState, CreditEvent, CreditRecord, Invoice } from "./types";
import { D, Decimal, formatMoney, isValidDecimal, str2 } from "./audit/money";
import { parseISO } from "./audit/normalize";

export type CreditStatus = "unmatched" | "awaiting" | "partial" | "settled";

export const CREDIT_STATUS_LABEL: Record<CreditStatus, string> = {
  unmatched: "Not matched to a bill",
  awaiting: "Waiting: not confirmed applied or refunded",
  partial: "Partly settled",
  settled: "Settled",
};

export interface CreditPosition {
  credit: Invoice;
  record?: CreditRecord;
  related?: Invoice;
  total: Decimal;
  applied: Decimal;
  refunded: Decimal;
  settled: Decimal;
  remaining: Decimal;
  status: CreditStatus;
  /** Settlement events that have not been reversed. */
  live: CreditEvent[];
}

const isSettlement = (e: CreditEvent) => e.kind === "applied" || e.kind === "refunded";

/** Where one credit note stands, derived only from what the user recorded. */
export function creditPosition(state: Pick<AppState, "invoices" | "credits">, credit: Invoice): CreditPosition {
  const record = state.credits.find((c) => c.creditId === credit.id);
  const total = D(credit.total);
  // Actions validate this already. Re-check restored data so malformed backups cannot claim more than the note's value,
  // reverse unrelated entries, or count a credit applied to a different vendor/currency.
  const liveById = new Map<string, CreditEvent>();
  const reversed = new Set<string>();
  let running = D(0);
  for (const e of record?.events ?? []) {
    if (isSettlement(e)) {
      if (!e.amount || !isValidDecimal(e.amount) || D(e.amount).lte(0)) continue;
      const appliedTo = e.kind === "applied" && e.invoiceId ? state.invoices.find((i) => i.id === e.invoiceId) : undefined;
      if (appliedTo && (appliedTo.isCredit || appliedTo.vendorId !== credit.vendorId || appliedTo.currency !== credit.currency)) continue;
      const amount = D(e.amount);
      if (running.plus(amount).gt(total)) continue;
      liveById.set(e.id, e);
      running = running.plus(amount);
    } else if (e.kind === "reversed" && e.reverses && !reversed.has(e.reverses)) {
      const target = liveById.get(e.reverses);
      if (!target) continue;
      liveById.delete(e.reverses);
      reversed.add(e.reverses);
      running = running.minus(D(target.amount ?? 0));
    }
  }
  const live = [...liveById.values()];
  const sumOf = (kind: "applied" | "refunded") => live.filter((e) => e.kind === kind).reduce((a, e) => a.plus(D(e.amount)), D(0));
  const applied = sumOf("applied"), refunded = sumOf("refunded");
  const settled = applied.plus(refunded);
  const remaining = Decimal.max(0, total.minus(settled));
  const linked = record?.relatedInvoiceId ? state.invoices.find((i) => i.id === record.relatedInvoiceId && !i.isCredit) : undefined;
  const related = linked && linked.vendorId === credit.vendorId && linked.currency === credit.currency ? linked : undefined;
  const status: CreditStatus = remaining.lte(0) && settled.gt(0) ? "settled" : settled.gt(0) ? "partial" : related ? "awaiting" : "unmatched";
  return { credit, record, related, total, applied, refunded, settled, remaining, status, live };
}

export function allCreditPositions(state: Pick<AppState, "invoices" | "credits">): CreditPosition[] {
  return state.invoices.filter((i) => i.isCredit).map((c) => creditPosition(state, c));
}

/** Credits still needing the user: not matched, or not fully confirmed applied/refunded. Unmatched first, then largest balance. */
export function creditsToResolve(state: Pick<AppState, "invoices" | "credits">): CreditPosition[] {
  const rank = { unmatched: 0, awaiting: 1, partial: 2, settled: 3 } as const;
  return allCreditPositions(state)
    .filter((p) => p.status !== "settled")
    .sort((a, b) => rank[a.status] - rank[b.status] || b.remaining.comparedTo(a.remaining));
}

/** Money still to be accounted for, per currency (never summed across currencies). */
export function creditBalanceByCurrency(positions: CreditPosition[]): { currency: string; amount: Decimal; count: number }[] {
  const map = new Map<string, { currency: string; amount: Decimal; count: number }>();
  for (const p of positions) {
    if (p.remaining.lte(0)) continue;
    const t = map.get(p.credit.currency) ?? { currency: p.credit.currency, amount: D(0), count: 0 };
    map.set(p.credit.currency, { ...t, amount: t.amount.plus(p.remaining), count: t.count + 1 });
  }
  return [...map.values()];
}

export const formatBalances = (b: ReturnType<typeof creditBalanceByCurrency>) => b.map((t) => formatMoney(t.amount, t.currency)).join(" · ");

/** Bills a credit may be linked to or applied against: same vendor, same currency, not itself a credit. */
export function linkCandidates(state: Pick<AppState, "invoices">, credit: Invoice): Invoice[] {
  return state.invoices
    .filter((i) => !i.isCredit && i.vendorId === credit.vendorId && i.currency === credit.currency)
    .sort((a, b) => (parseISO(b.date) ?? 0) - (parseISO(a.date) ?? 0) || b.createdAt - a.createdAt);
}

export const billLabel = (i: Invoice) => `${i.vendorName} · ${i.number}`;

export type CreditResult = { ok: true; state: AppState } | { ok: false; error: string };
type Ctx = { id: () => string; now: () => string };

function withRecord(state: AppState, creditId: string, fn: (r: CreditRecord) => CreditRecord): AppState {
  const existing = state.credits.find((c) => c.creditId === creditId);
  if (existing) return { ...state, credits: state.credits.map((c) => (c === existing ? fn(c) : c)) };
  return { ...state, credits: [...state.credits, fn({ id: `cr-${creditId}`.slice(0, 160), creditId, events: [] })] };
}

function findCredit(state: AppState, creditId: string): Invoice | undefined {
  return state.invoices.find((i) => i.id === creditId && i.isCredit);
}

/** Link a credit note to the bill it relates to, or pass `null` to unlink. Both are recorded in the history. */
export function linkCredit(state: AppState, creditId: string, invoiceId: string | null, ctx: Ctx): CreditResult {
  const credit = findCredit(state, creditId);
  if (!credit) return { ok: false, error: "That credit note no longer exists." };
  const current = state.credits.find((c) => c.creditId === creditId)?.relatedInvoiceId;
  if (invoiceId === null) {
    if (!current) return { ok: false, error: "This credit note is not linked to anything." };
    const old = state.invoices.find((i) => i.id === current);
    const ev: CreditEvent = { id: ctx.id(), at: ctx.now(), kind: "unlinked", text: `Unlinked from ${old ? billLabel(old) : "a bill"}.`, invoiceId: current, invoiceLabel: old ? billLabel(old) : undefined };
    return { ok: true, state: withRecord(state, creditId, (r) => ({ ...r, relatedInvoiceId: undefined, events: [...r.events, ev] })) };
  }
  const bill = state.invoices.find((i) => i.id === invoiceId);
  if (!bill || bill.isCredit) return { ok: false, error: "Choose a bill, not another credit note." };
  if (bill.vendorId !== credit.vendorId) return { ok: false, error: "A credit note can only be linked to a bill from the same vendor." };
  if (bill.currency !== credit.currency) return { ok: false, error: `The credit note is in ${credit.currency} but that bill is in ${bill.currency}. They cannot be matched.` };
  if (current === invoiceId) return { ok: false, error: "Already linked to that bill." };
  const ev: CreditEvent = { id: ctx.id(), at: ctx.now(), kind: "linked", text: `Linked to ${billLabel(bill)}. This only records which bill it relates to; it does not mean the credit was applied.`, invoiceId: bill.id, invoiceLabel: billLabel(bill) };
  return { ok: true, state: withRecord(state, creditId, (r) => ({ ...r, relatedInvoiceId: bill.id, events: [...r.events, ev] })) };
}

export interface SettlementInput {
  kind: "applied" | "refunded";
  amount: string;
  date: string;
  /** Evidence: required, so every settlement can be traced. */
  reference: string;
  /** Required when `kind` is "applied": the bill the credit reduced. */
  appliedToId?: string;
  note?: string;
  /** The user's explicit confirmation that they checked their statement, bank or the vendor's account. */
  confirmed: boolean;
}

/** Validate and record that some or all of a credit was applied to a bill or refunded. Never infers; always needs confirmation + evidence. */
export function recordSettlement(state: AppState, creditId: string, input: SettlementInput, ctx: Ctx & { today: string }): CreditResult {
  const credit = findCredit(state, creditId);
  if (!credit) return { ok: false, error: "That credit note no longer exists." };
  const pos = creditPosition(state, credit);
  if (!input.confirmed) return { ok: false, error: "Tick the box to confirm you checked this against your statement, bank or the vendor's account." };
  const amount = input.amount.trim();
  if (!isValidDecimal(amount) || amount.startsWith("-") || D(amount).lte(0)) return { ok: false, error: "Enter the amount as a positive number." };
  if (D(amount).gt(pos.remaining)) return { ok: false, error: `That is more than the ${formatMoney(pos.remaining, credit.currency)} still unaccounted for on this credit note.` };
  if (parseISO(input.date) === null) return { ok: false, error: "Enter the date it happened (YYYY-MM-DD)." };
  if (input.date > ctx.today) return { ok: false, error: "That date is in the future. Only record something that has already happened." };
  const reference = input.reference.trim();
  if (!reference) return { ok: false, error: "Add a reference as evidence, such as a refund ID, remittance number or statement line." };
  if (reference.length > 200 || (input.note ?? "").length > 1000) return { ok: false, error: "That reference or note is too long." };
  let bill: Invoice | undefined;
  if (input.kind === "applied") {
    bill = state.invoices.find((i) => i.id === input.appliedToId);
    if (!bill || bill.isCredit) return { ok: false, error: "Choose the bill this credit was applied to." };
    if (bill.vendorId !== credit.vendorId || bill.currency !== credit.currency) return { ok: false, error: "The credit can only be applied to a bill from the same vendor in the same currency." };
  }
  const amt = str2(D(amount));
  const text = input.kind === "applied"
    ? `Confirmed ${formatMoney(amt, credit.currency)} applied to ${billLabel(bill!)}.`
    : `Confirmed ${formatMoney(amt, credit.currency)} refunded.`;
  const ev: CreditEvent = {
    id: ctx.id(), at: ctx.now(), kind: input.kind, text: input.note?.trim() ? `${text} ${input.note.trim()}` : text,
    amount: amt, date: input.date, reference, confirmed: true,
    ...(bill ? { invoiceId: bill.id, invoiceLabel: billLabel(bill) } : {}),
  };
  return { ok: true, state: withRecord(state, creditId, (r) => ({ ...r, events: [...r.events, ev] })) };
}

/** Undo a settlement entered by mistake. The original stays in the history, marked as reversed. */
export function reverseSettlement(state: AppState, creditId: string, eventId: string, reason: string, ctx: Ctx): CreditResult {
  const credit = findCredit(state, creditId);
  if (!credit) return { ok: false, error: "That credit note no longer exists." };
  const pos = creditPosition(state, credit);
  const target = pos.live.find((e) => e.id === eventId);
  if (!target) return { ok: false, error: "That entry can't be reversed (it may already have been)." };
  if (!reason.trim()) return { ok: false, error: "Say why you are reversing it, so the history makes sense later." };
  if (reason.length > 1000) return { ok: false, error: "That reason is too long." };
  const ev: CreditEvent = { id: ctx.id(), at: ctx.now(), kind: "reversed", reverses: eventId, text: `Reversed: ${reason.trim()}`, amount: target.amount };
  return { ok: true, state: withRecord(state, creditId, (r) => ({ ...r, events: [...r.events, ev] })) };
}

/** A free-text note in the history (for example "asked the vendor on 3 Dec"). */
export function addCreditNote(state: AppState, creditId: string, text: string, ctx: Ctx): CreditResult {
  if (!findCredit(state, creditId)) return { ok: false, error: "That credit note no longer exists." };
  const t = text.trim();
  if (!t) return { ok: false, error: "Write a note first." };
  if (t.length > 1000) return { ok: false, error: "That note is too long." };
  return { ok: true, state: withRecord(state, creditId, (r) => ({ ...r, events: [...r.events, { id: ctx.id(), at: ctx.now(), kind: "note", text: t }] })) };
}

/** After an invoice is deleted: drop tracking for a deleted credit note, and unlink (with a history entry) any credit that pointed at a deleted bill. */
export function pruneCredits(state: AppState, ctx: Ctx): AppState {
  const creditIds = new Set(state.invoices.filter((i) => i.isCredit).map((i) => i.id));
  const billIds = new Set(state.invoices.filter((i) => !i.isCredit).map((i) => i.id));
  return {
    ...state,
    credits: state.credits.filter((c) => creditIds.has(c.creditId)).map((c) => c.relatedInvoiceId && !billIds.has(c.relatedInvoiceId)
      ? { ...c, relatedInvoiceId: undefined, events: [...c.events, { id: ctx.id(), at: ctx.now(), kind: "unlinked" as const, text: "The linked bill was deleted, so this credit note is unmatched again.", invoiceId: c.relatedInvoiceId }] }
      : c),
  };
}
