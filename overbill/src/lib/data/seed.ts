import { D, round2, str2, sum } from "../audit/money";
import type { AppState, ContractRate, Currency, Invoice, PaymentStatus, RecoveryRecord, Vendor } from "../types";

export const SEED_VERSION = 1;

export const vendors: Vendor[] = [
  { id: "v-northwind", name: "Northwind Hosting", category: "Infrastructure", billing: "fixed", monitoring: { enabled: true, notify: true } },
  { id: "v-lumen", name: "Lumen Cloud", category: "Cloud usage", billing: "variable", monitoring: { enabled: true, notify: true } },
  { id: "v-brightline", name: "Brightline Telecom", category: "Telecom", billing: "fixed", monitoring: { enabled: true, notify: true } },
  { id: "v-orbit", name: "Orbit Workspace", category: "Workspace", billing: "fixed", monitoring: { enabled: true, notify: true } },
  { id: "v-stackly", name: "Stackly Software", category: "Software", billing: "fixed", monitoring: { enabled: true, notify: true } },
  { id: "v-meridian", name: "Meridian Accounting", category: "Professional services", billing: "variable", monitoring: { enabled: true, notify: true } },
];

export const contractRates: ContractRate[] = [
  { id: "cr-meridian-bookkeeping", vendorId: "v-meridian", match: "bookkeeping", unitPrice: "85.00", unit: "hour", currency: "EUR", note: "Engagement letter, Jan 2026" },
];

type LineSpec = [desc: string, qty: string, price: string, kind?: "item" | "fee", statedTotal?: string];

interface Spec {
  id: string; vendor: string; number: string; date: string; terms: number;
  lines: LineSpec[]; status?: PaymentStatus; createdAt: number;
}

let seq = 0;

function build(s: Spec): Invoice {
  const v = vendors.find((x) => x.id === s.vendor)!;
  const rate = "21";
  const lineItems = s.lines.map(([description, quantity, unitPrice, kind = "item", statedTotal], i) => ({
    id: `${s.id}-l${i + 1}`, description, quantity, unitPrice,
    total: statedTotal ?? str2(D(quantity).times(D(unitPrice))), kind, taxRate: rate,
  }));
  const subtotal = sum(lineItems.filter((l) => l.kind === "item").map((l) => D(l.total)));
  const fees = sum(lineItems.filter((l) => l.kind === "fee").map((l) => D(l.total)));
  const tax = round2(subtotal.plus(fees).times(rate).div(100));
  const total = subtotal.plus(fees).plus(tax);
  const due = new Date(Date.parse(s.date) + s.terms * 86_400_000).toISOString().slice(0, 10);
  return {
    id: s.id, vendorId: v.id, vendorName: v.name, number: s.number, date: s.date, dueDate: due,
    currency: "EUR" as Currency, lineItems, subtotal: str2(subtotal), discounts: "0.00", fees: str2(fees),
    taxAmount: str2(tax), taxRate: rate, total: str2(total), paymentStatus: s.status ?? "paid", source: "demo", createdAt: s.createdAt + seq++,
  };
}

const month = (y: number, m: number, d = 1) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const ym = (i: number): [number, number] => { const m = 5 + i; return m <= 12 ? [2026, m] : [2027, m - 12]; };
const T = 1_000;

const invoices: Invoice[] = [];

// Northwind: six identical €120 invoices, then €138 (unexpected increase)
for (let i = 0; i < 7; i++) {
  const [y, m] = ym(i);
  const last = i === 6;
  invoices.push(build({
    id: `inv-northwind-${i + 1}`, vendor: "v-northwind", number: `NW-2026-${String(41 + i).padStart(4, "0")}`, date: month(y, m), terms: 30,
    lines: [["Managed hosting – Pro plan", "1", last ? "138.00" : "120.00"]], status: last ? "unpaid" : "paid", createdAt: (i + 1) * T,
  }));
}

// Lumen Cloud: usage-based, legitimately varying (latest is ~14% above the 6-month average — normal for usage billing)
const compute = ["820", "905", "760", "980", "870", "940", "1010"];
const storage = ["400", "410", "420", "430", "450", "455", "470"];
for (let i = 0; i < 7; i++) {
  const [y, m] = ym(i);
  invoices.push(build({
    id: `inv-lumen-${i + 1}`, vendor: "v-lumen", number: `LC-${202605 + i}`, date: month(y, m, 2), terms: 30,
    lines: [["Compute hours", compute[i], "0.09"], ["Object storage (GB-month)", storage[i], "0.023"]],
    status: i === 6 ? "unpaid" : "paid", createdAt: (i + 1) * T + 100,
  }));
}

// Brightline Telecom: stable €49 + static IP; latest adds a new "Network administration fee"
for (let i = 0; i < 5; i++) {
  const [y, m] = ym(i + 2);
  const last = i === 4;
  invoices.push(build({
    id: `inv-brightline-${i + 1}`, vendor: "v-brightline", number: `BT-${88100 + i}`, date: month(y, m, 3), terms: 14,
    lines: [["Business fibre 500/500", "1", "49.00"], ["Static IP address", "1", "5.00", "fee"], ...(last ? [["Network administration fee", "1", "7.50", "fee"] as LineSpec] : [])],
    status: last ? "overdue" : "paid", createdAt: (i + 1) * T + 200,
  }));
}

// Orbit Workspace: stable €280 desk; November invoice was re-sent under the same number
for (let i = 0; i < 6; i++) {
  const [y, m] = ym(i + 1);
  const last = i === 5;
  invoices.push(build({
    id: `inv-orbit-${i + 1}`, vendor: "v-orbit", number: `OW-${2206 + i}`, date: month(y, m), terms: 15,
    lines: [["Dedicated desk – monthly", "1", "280.00"]], status: last ? "unpaid" : "paid", createdAt: (i + 1) * T + 300,
  }));
}
invoices.push(build({
  id: "inv-orbit-resend", vendor: "v-orbit", number: "OW-2211", date: month(2026, 11, 3), terms: 15,
  lines: [["Dedicated desk – monthly", "1", "280.00"]], status: "unpaid", createdAt: 8 * T + 300,
}));

// Stackly Software: 12 seats × €9.50 = €114.00; latest line prints €124.00 (arithmetic discrepancy)
for (let i = 0; i < 4; i++) {
  const [y, m] = ym(i + 3);
  const last = i === 3;
  invoices.push(build({
    id: `inv-stackly-${i + 1}`, vendor: "v-stackly", number: `STK-${5400 + i}`, date: month(y, m, 5), terms: 30,
    lines: [["Team plan – seats", "12", "9.50", "item", last ? "124.00" : undefined]], status: last ? "unpaid" : "paid", createdAt: (i + 1) * T + 400,
  }));
}

// Meridian Accounting: hourly, varying; latest bills €95/h against the €85/h agreed rate
const hours = ["7.5", "8", "9", "8"];
for (let i = 0; i < 4; i++) {
  const [y, m] = ym(i + 3);
  const last = i === 3;
  invoices.push(build({
    id: `inv-meridian-${i + 1}`, vendor: "v-meridian", number: `MA-${310 + i}`, date: month(y, m, 8), terms: 21,
    lines: [["Bookkeeping & reporting (hourly)", hours[i], last ? "95.00" : "85.00"]], status: last ? "unpaid" : "paid", createdAt: (i + 1) * T + 500,
  }));
}

const rec = (r: Omit<RecoveryRecord, "currency">): RecoveryRecord => ({ ...r, currency: "EUR", source: "demo" });

export const recovery: RecoveryRecord[] = [
  rec({ id: "rec-1", vendorId: "v-orbit", vendorName: "Orbit Workspace", invoiceId: "inv-orbit-resend", findingId: "inv-orbit-resend:duplicate_invoice:exact-inv-orbit-6", title: "Duplicate November invoice OW-2211", amount: "338.80", status: "flagged", notes: "Same number and total re-sent on 3 Nov. Hold payment of the second copy.", createdAt: "2026-11-24", updatedAt: "2026-11-24" }),
  rec({ id: "rec-2", vendorId: "v-meridian", vendorName: "Meridian Accounting", invoiceId: "inv-meridian-4", findingId: "inv-meridian-4:contract_rate:rate-cr-meridian-bookkeeping-inv-meridian-4-l1", title: "Hourly rate above engagement letter", amount: "96.80", status: "disputed", notes: "Emailed accountant on 20 Nov asking for a corrected invoice at €85/h.", createdAt: "2026-11-19", updatedAt: "2026-11-20" }),
  rec({ id: "rec-3", vendorId: "v-northwind", vendorName: "Northwind Hosting", title: "Backup add-on billed after cancellation", amount: "64.00", status: "vendor_responded", notes: "Vendor says cancellation was processed late; awaiting credit note.", createdAt: "2026-10-12", updatedAt: "2026-11-02" }),
  rec({ id: "rec-4", vendorId: "v-brightline", vendorName: "Brightline Telecom", title: "Late fee charged despite on-time payment", amount: "25.00", status: "credit_issued", notes: "Credit note BT-CN-114 issued; will net off next invoice.", createdAt: "2026-09-18", updatedAt: "2026-10-01" }),
  rec({ id: "rec-5", vendorId: "v-lumen", vendorName: "Lumen Cloud", title: "Storage billed for deleted volumes", amount: "42.30", status: "recovered", notes: "Refunded to card on 14 Oct.", createdAt: "2026-09-30", updatedAt: "2026-10-14" }),
  rec({ id: "rec-6", vendorId: "v-northwind", vendorName: "Northwind Hosting", title: "Setup fee charged twice", amount: "150.10", status: "recovered", notes: "Refunded after support ticket #4471.", createdAt: "2026-07-02", updatedAt: "2026-07-21" }),
  rec({ id: "rec-7", vendorId: "v-stackly", vendorName: "Stackly Software", title: "Seat count looked high", amount: "19.00", status: "dismissed", notes: "Two contractors were added mid-month. Billing was correct.", createdAt: "2026-08-14", updatedAt: "2026-08-15" }),
];

export function createSeedState(): AppState {
  return {
    version: 1,
    user: { id: "u-demo", name: "Demo User", email: "demo@overbill.example", company: "Demo Studio" },
    vendors: structuredClone(vendors),
    invoices: structuredClone(invoices),
    contractRates: structuredClone(contractRates),
    recovery: structuredClone(recovery),
    decisions: {},
    settings: {
      currency: "EUR", sensitivity: "balanced",
      thresholds: { info: 5, review: 10, high: 20 }, tolerance: "0.01", exceptions: [],
      defaults: { dateFormat: "iso", timezone: "UTC", paymentTermsDays: 30 },
      reminders: { overdueReview: true, upcomingDue: true, vendorReply: true, reviewAfterDays: 7, dueWithinDays: 7, replyAfterDays: 14, browser: false },
      setup: { defaultsConfirmed: false, dismissed: false },
      privacy: { keepUploadedFiles: false, analytics: false },
      disabledRules: [],
    },
  };
}
