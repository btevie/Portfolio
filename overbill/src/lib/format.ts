export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const STATUS_LABEL = {
  flagged: "Flagged", disputed: "Disputed", vendor_responded: "Vendor responded",
  credit_issued: "Credit issued (pending)", recovered: "Recovered", dismissed: "Dismissed",
} as const;

/** Up to two capital letters from a name; tolerates empty or double spaces. */
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
