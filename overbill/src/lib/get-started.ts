/** The "Get started" checklist shows once after someone first signs up or logs in, until they hide it or finish it. */
const SIGNED_IN = "overbill:signed-in";
const HIDDEN = "overbill:getting-started";
export const GET_STARTED_EVENT = "overbill:gs";

export function startGetStarted() {
  try { localStorage.setItem(SIGNED_IN, "1"); localStorage.removeItem(HIDDEN); } catch { /* storage blocked: the checklist just will not show */ }
  window.dispatchEvent(new Event(GET_STARTED_EVENT));
}
export function hideGetStarted() {
  try { localStorage.setItem(HIDDEN, "done"); } catch { /* ignore */ }
  window.dispatchEvent(new Event(GET_STARTED_EVENT));
}
export function getStartedVisible(): boolean {
  try { return localStorage.getItem(SIGNED_IN) === "1" && localStorage.getItem(HIDDEN) !== "done"; } catch { return false; }
}

/** Forget the small interface flags (not the theme) when someone erases everything. */
export function forgetLocalFlags() {
  try { localStorage.removeItem(SIGNED_IN); localStorage.removeItem(HIDDEN); } catch { /* ignore */ }
  window.dispatchEvent(new Event(GET_STARTED_EVENT));
}
