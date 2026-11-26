export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const STATUS_LABEL = {
  flagged: "Flagged", disputed: "Disputed", vendor_responded: "Vendor responded",
  credit_issued: "Credit issued", recovered: "Recovered", dismissed: "Dismissed",
} as const;
