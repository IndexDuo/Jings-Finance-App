"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "reset" | "update";
const labels: Record<Mode, string> = { login: "Sign in", signup: "Create account", reset: "Reset password", update: "Set a new password" };
const input = "w-full rounded-xl border border-separator bg-system-bg px-4 py-3 text-[17px] focus-visible:outline-2 focus-visible:outline-system-blue disabled:opacity-50";

export function AuthForm({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null); setMessage(null);
    if ((mode === "signup" || mode === "update") && password !== confirmation) {
      setError("Passwords must match."); return;
    }
    setPending(true);
    try {
      const client = createClient();
      const callback = `${window.location.origin}/auth/callback`;
      if (mode === "login") {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new Error("Could not sign in. Check your email and password.");
        window.location.replace("/log");
      } else if (mode === "signup") {
        const { data, error } = await client.auth.signUp({ email, password,
          options: { emailRedirectTo: `${callback}?next=/onboarding` } });
        if (error) throw new Error("Could not create the account. Check your details and try again.");
        if (data.session) window.location.replace("/onboarding");
        else setMessage("Check your email to confirm your account, then sign in.");
      } else if (mode === "reset") {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${callback}?next=/update-password` });
        if (error) throw new Error("Could not send a reset link. Please try again later.");
        setMessage("If an account exists for this email, you will receive a password reset link.");
      } else {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw new Error("Could not update your password. Request a new reset link and try again.");
        await client.auth.signOut();
        window.location.replace("/login");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setPending(false); }
  }

  return <main className="mx-auto mt-20 w-full max-w-sm px-6 pb-12">
    <h1 className="mb-6 font-ios text-[28px] font-semibold">{labels[mode]}</h1>
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        {mode !== "update" && <label className="block text-[15px]">Email
          <input className={`${input} mt-1`} aria-label="Email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/>
        </label>}
        {mode !== "reset" && <label className="block text-[15px]">Password
          <input className={`${input} mt-1`} aria-label="Password" type="password" required minLength={mode === "login" ? undefined : 8}
            autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)}/>
        </label>}
        {(mode === "signup" || mode === "update") && <label className="block text-[15px]">Confirm password
          <input className={`${input} mt-1`} aria-label="Confirm password" type="password" required minLength={8} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)}/>
        </label>}
        <button className="min-h-12 w-full rounded-xl bg-system-blue px-4 py-3 text-[17px] font-medium text-white disabled:opacity-50" type="submit">{pending ? "Please wait…" : labels[mode]}</button>
      </fieldset>
      {error && <p role="alert" className="text-system-red">{error}</p>}
      {message && <p role="status" className="text-secondary-label">{message}</p>}
    </form>
    <nav aria-label="Account" className="mt-6 flex flex-wrap gap-4 text-system-blue">
      {mode !== "login" && <Link href="/login">Sign in</Link>}
      {mode === "login" && <><Link href="/signup">Create account</Link><Link href="/reset-password">Forgot password?</Link></>}
    </nav>
  </main>;
}
