"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { actions, useAppState } from "@/lib/data/store";
import { GOOGLE_CLIENT_ID, signInWithGoogle } from "@/lib/google-signin";
import { startGetStarted } from "@/lib/get-started";
import { CleanMinimalSignIn } from "@/components/ui/clean-minimal-sign-in";
import { Avatar } from "@/components/avatar";
import { ProfilePictureDialog } from "@/components/profile-picture-dialog";
import { Button, Modal } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

/** Log in / sign up for a browser-only app: the "account" is the profile saved on this device. No passwords are collected. */
export function AuthForm({ mode }: { mode: "log-in" | "sign-up" }) {
  const router = useRouter();
  const appState = useAppState();
  const user = appState.user;
  const [ask, setAsk] = useState(false);
  // Nothing but the fictional sample set is saved here: ask before showing it, instead of just showing it.
  const sampleOnly = appState.invoices.length > 0 && appState.invoices.every((i) => i.source === "demo");
  const finish = () => { startGetStarted(); if (sampleOnly) setAsk(true); else router.push("/dashboard"); };
  const up = mode === "sign-up";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picDialog, setPicDialog] = useState(false);
  // On the log-in page, recognise the saved profile as soon as its email is typed and greet them with their picture.
  const recognised = !up && email.trim() !== "" && email.trim().toLowerCase() === user.email.toLowerCase();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = email.trim();
    if (!clean || !password) { setError("Enter both your email and a password."); return; }
    if (!/^\S+@\S+\.\S+$/.test(clean)) { setError("Enter a valid email address."); return; }
    if (up) {
      if (!name.trim()) { setError("Enter your name."); return; }
      actions.updateUser({ name: name.trim(), email: clean, company: user.company });
    } else if (clean.toLowerCase() !== user.email.toLowerCase()) {
      setError("No profile with that email on this device. Sign up to set one up.");
      return;
    }
    finish();
  }

  async function onGoogle() {
    setError(""); setNotice("");
    try {
      const g = await signInWithGoogle();
      actions.updateUser({ name: g.name, email: g.email, company: user.company, ...(g.picture ? { picture: g.picture } : {}) });
      finish();
    } catch (e) { setError(e instanceof Error ? e.message : "Google sign-in failed."); }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-white px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground sm:px-5 sm:py-6 dark:bg-background [font-family:var(--font-display),system-ui,sans-serif]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="Overbill home">
          <svg viewBox="0 0 28 28" className="size-9" aria-hidden><rect width="28" height="28" rx="8" className="fill-green-700" /><circle cx="14" cy="14" r="6.5" fill="none" stroke="white" strokeWidth="3" /><path d="M17.5 5.5 22 10" stroke="white" strokeOpacity="0.65" strokeWidth="3" strokeLinecap="round" /></svg>
          <span className="text-2xl font-semibold tracking-tight">Overbill</span>
        </Link>
        <ThemeToggle className="size-11 rounded-full" />
      </header>

      <main className="flex flex-1 items-start justify-center py-4 sm:items-center sm:py-8">
        <CleanMinimalSignIn
          mode={mode}
          avatar={recognised ? <Avatar name={user.name} email={user.email} picture={user.picture} size={64} /> : up ? (
            <button type="button" onClick={() => setPicDialog(true)} aria-label="Add a profile picture" className="group relative cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar name={name} email={email} picture={user.picture} size={64} />
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Change</span>
            </button>
          ) : undefined}
          title={recognised ? `Welcome back, ${user.name.split(" ")[0] || "there"}` : up ? "Set up your profile" : "Welcome back"}
          subtitle={up ? "Your profile is saved on this device only. The password is not stored or checked, and this does not lock your data." : "Use the email saved on this device. The password is not checked and does not lock your data."}
          notice={notice}
          fields={[
            ...(up ? [{ id: "a-name", label: "Name", autoComplete: "name", value: name, icon: "user" as const, onChange: (v: string) => { setName(v); setError(""); } }] : []),
            { id: "a-email", label: "Email", type: "email", inputMode: "email" as const, autoComplete: "email", value: email, icon: "mail" as const, onChange: (v: string) => { setEmail(v); setError(""); } },
            { id: "a-password", label: "Password", type: "password", autoComplete: up ? "new-password" : "current-password", value: password, icon: "lock" as const, onChange: (v: string) => { setPassword(v); setError(""); } },
          ]}
          error={error}
          onForgot={() => { setError(""); setNotice("There is no password to reset in this demo. Your profile is saved on this device."); }}
          onGoogle={GOOGLE_CLIENT_ID ? onGoogle : undefined}
          submitLabel={up ? "Sign up" : "Log in"}
          onSubmit={submit}
          altAction={<Link href="/demo" className="inline-flex h-12 items-center justify-center rounded-xl border bg-background text-base font-semibold transition-colors hover:bg-muted">Try sample data</Link>}
          footer={<>{up ? "Already set up? " : "New here? "}<Link href={up ? "/log-in" : "/sign-up"} className="inline-flex min-h-11 items-center px-1 font-semibold text-green-700 hover:underline dark:text-green-500">{up ? "Log in" : "Sign up"}</Link></>}
        />
      </main>
      <ProfilePictureDialog open={picDialog} onClose={() => setPicDialog(false)} name={name || undefined} />
      <Modal open={ask} onClose={() => setAsk(false)} title="Start with sample data?">
        <p className="text-sm text-muted-foreground">Sample data is a set of fictional vendors and invoices so you can look around first. You can load it or clear it any time from your profile menu.</p>
        <div className="mt-5 grid gap-2 sm:flex sm:justify-end">
          <Button onClick={() => { actions.startEmpty(); router.push("/dashboard"); }}>Start empty</Button>
          <Button variant="primary" onClick={() => router.push("/dashboard")}>Use sample data</Button>
        </div>
      </Modal>
    </div>
  );
}
