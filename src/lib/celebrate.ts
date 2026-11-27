/** Tiny reward moments: a haptic tap on phones and, for big wins, confetti plus a message. */
export type Celebration = { kind: "win" | "clear" | "step"; message?: string };

export function haptic(ms: number | number[] = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(ms); } catch { /* not supported */ }
  }
}

export function celebrate(c: Celebration) {
  if (typeof window === "undefined") return;
  haptic(c.kind === "win" ? [12, 40, 24] : c.kind === "clear" ? [10, 30, 10] : 8);
  window.dispatchEvent(new CustomEvent<Celebration>("overbill:celebrate", { detail: c }));
}
