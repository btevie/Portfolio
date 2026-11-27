export interface ParsedContractTerms {
  renewalDate?: string;
  noticeDays?: number;
  upliftCapPct?: string;
  matchedNotes: string[];
}

export function parseContractText(raw: string): ParsedContractTerms {
  const text = raw.trim();
  if (!text) return { matchedNotes: [] };

  const out: ParsedContractTerms = { matchedNotes: [] };

  const capMatch =
    text.match(/(?:max(?:imaal|imum)?|cap(?:ped)?(?:\s+at)?|ten\s+hoogste|niet\s+meer\s+dan)\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i) ??
    text.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:max(?:imaal|imum)?|cap|indexatie\s*max|uplift\s*cap)/i);
  if (capMatch && capMatch[1]) {
    const pct = capMatch[1].replace(",", ".");
    out.upliftCapPct = pct;
    out.matchedNotes.push(`Price cap: ${pct}%`);
  }

  const noticeDaysMatch =
    text.match(/(?:opzegtermijn(?:\s+van)?|notice(?:\s+period)?(?:\s+of)?)\s*(\d{1,3})\s*(dag|dagen|day|days|maand|maanden|month|months|week|weken|weeks)/i) ??
    text.match(/(\d{1,3})\s*(dag|dagen|day|days|maand|maanden|month|months)\s*(?:opzegtermijn|notice)/i);
  if (noticeDaysMatch && noticeDaysMatch[1] && noticeDaysMatch[2]) {
    const n = Number(noticeDaysMatch[1]);
    const unit = noticeDaysMatch[2].toLowerCase();
    const days = unit.startsWith("maand") || unit.startsWith("month") ? n * 30 : unit.startsWith("week") ? n * 7 : n;
    if (days > 0 && days <= 999) {
      out.noticeDays = days;
      out.matchedNotes.push(`Notice: ${days} days`);
    }
  }

  const isoDateMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const euDateMatch = text.match(/\b(\d{2})[-/](\d{2})[-/](20\d{2})\b/);
  if (isoDateMatch && isoDateMatch[1]) {
    out.renewalDate = isoDateMatch[1];
    out.matchedNotes.push(`Renewal date: ${isoDateMatch[1]}`);
  } else if (euDateMatch && euDateMatch[1] && euDateMatch[2] && euDateMatch[3]) {
    const iso = `${euDateMatch[3]}-${euDateMatch[2]}-${euDateMatch[1]}`;
    out.renewalDate = iso;
    out.matchedNotes.push(`Renewal date: ${iso}`);
  }

  return out;
}
