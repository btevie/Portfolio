/**
 * "Sign in with Google" using Google Identity Services, entirely in the browser.
 * It needs a Google OAuth client ID (NEXT_PUBLIC_GOOGLE_CLIENT_ID) with this site's address under "Authorized JavaScript origins".
 * The result only fills in the local profile (name and email). Overbill has no server, so nothing is verified server-side
 * and the Google account does not protect your data: anyone using this browser profile can still open it.
 */

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

type Credential = { credential?: string };
type GsiNotification = { isNotDisplayed(): boolean; isSkippedMoment(): boolean; isDismissedMoment?(): boolean; getDismissedReason?(): string };
declare global {
  interface Window {
    google?: { accounts: { id: { initialize(o: { client_id: string; callback: (c: Credential) => void; use_fedcm_for_prompt?: boolean }): void; prompt(cb?: (n: GsiNotification) => void): void } } };
  }
}

let loading: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error("Could not load Google sign-in.")); };
    document.head.appendChild(s);
  });
  return loading;
}

export type GoogleProfile = { name: string; email: string; picture?: string };

function decode(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1];
    const json = decodeURIComponent(atob(part.replace(/-/g, "+").replace(/_/g, "/")).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    return JSON.parse(json);
  } catch { return null; }
}

/** Opens Google's prompt. Resolves with the signed-in profile, or rejects with a message fit to show the user. */
export async function signInWithGoogle(): Promise<GoogleProfile> {
  if (!GOOGLE_CLIENT_ID) throw new Error("Google sign-in is not set up yet.");
  await loadGsi();
  return new Promise<GoogleProfile>((resolveRaw, rejectRaw) => {
    // Under FedCM a cancelled prompt may emit no "skipped" signal, so the wait is bounded: the caller always gets a profile or an error.
    const giveUp = setTimeout(() => rejectRaw(new Error("Google sign-in was closed or timed out. Try again.")), 90_000);
    const resolve = (p: GoogleProfile) => { clearTimeout(giveUp); resolveRaw(p); };
    const reject = (e: Error) => { clearTimeout(giveUp); rejectRaw(e); };
    window.google!.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: ({ credential }) => {
        const p = credential ? decode(credential) : null;
        const fresh = p && typeof p.exp === "number" && p.exp * 1000 > Date.now();
        if (!p || p.aud !== GOOGLE_CLIENT_ID || !fresh || typeof p.email !== "string" || p.email_verified !== true || (p.iss !== "https://accounts.google.com" && p.iss !== "accounts.google.com")) { reject(new Error("Google sign-in did not return a usable profile. Try again.")); return; }
        resolve({ name: typeof p.name === "string" && p.name ? p.name : p.email.split("@")[0], email: p.email, picture: typeof p.picture === "string" && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(p.picture) ? p.picture : undefined });
      },
    });
    window.google!.accounts.id.prompt((n) => {
      if (n.isDismissedMoment?.() && n.getDismissedReason?.() !== "credential_returned") reject(new Error("Google sign-in was closed. Try again."));
      else if (n.isNotDisplayed() || n.isSkippedMoment()) reject(new Error("Google did not open. Check that pop-ups and third-party sign-in are allowed, then try again."));
    });
  });
}
