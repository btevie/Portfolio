const FIELD_LABEL = /(?:due\s?date|invoice\s?date|vendor|invoice\s?(?:no\.?|#|number)|total|currency)\s?[:=]/gi;
/** Cuts a line where a known label starts after a gap of 2+ spaces or a tab. A linear scan, so long runs of spaces stay fast. */
export function splitLabelled(line: string): string[] {
  if (line.length > 400) return [line];
  const cuts: number[] = [];
  for (const m of line.matchAll(FIELD_LABEL)) {
    const at = m.index ?? 0;
    const before = line.slice(0, at);
    const gap = at > 1 && (line[at - 1] === "\t" || (line[at - 1] === " " && line[at - 2] === " "));
    // A single space is enough when the text before already holds a value (a date or number) and the label is a date/number one.
    const afterValue = line[at - 1] === " " && /\d\s*$/.test(before) && /^(?:due|invoice)/i.test(m[0]);
    if ((gap || afterValue) && before.trim()) cuts.push(at);
  }
  if (!cuts.length) return [line];
  return [line.slice(0, cuts[0]), ...cuts.map((c, k) => line.slice(c, cuts[k + 1]))];
}

