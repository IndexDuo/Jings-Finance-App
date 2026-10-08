"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { startDemo, leaveDemo } from "./actions";

type Turnstile = {
  render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void;
    "expired-callback": () => void; "error-callback": () => void; theme: string }) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};

export function StartDemo({ siteKey }: { siteKey?: string }) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>();
  const [ready, setReady] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string>(undefined);

  useEffect(() => {
    const turnstile = (window as Window & { turnstile?: Turnstile }).turnstile;
    if (!ready || !siteKey || !container.current || !turnstile) return;
    const id = turnstile.render(container.current, { sitekey: siteKey, theme: "auto", callback: setToken,
      "expired-callback": () => setToken(undefined), "error-callback": () => setToken(undefined) });
    widget.current = id;
    return () => { turnstile.remove(id); widget.current = undefined; };
  }, [ready, siteKey]);

  return <div className="space-y-4">
    {siteKey && <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)}
        onError={() => setError("The visitor check could not load. Please reload and try again.")} />
      <div ref={container} />
    </>}
    <button type="button" disabled={pending || Boolean(siteKey && !token)}
      className="w-full rounded-2xl bg-system-blue px-5 py-4 text-white font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-system-blue"
      onClick={() => transition(async () => {
        setError(null);
        const result = await startDemo({ captchaToken: token });
        if (result.ok) { router.push("/log"); router.refresh(); }
        else {
          setError(result.error);
          setToken(undefined);
          const turnstile = (window as Window & { turnstile?: Turnstile }).turnstile;
          if (widget.current && turnstile) turnstile.reset(widget.current);
        }
      })}>{pending ? "Preparing your demo…" : "Start demo"}</button>
    {error && <p role="alert" className="text-[13px] text-system-red">{error}</p>}
  </div>;
}

export function ResetDemo() {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div>
    <button type="button" disabled={pending} className="min-h-11 rounded-lg px-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-system-blue" onClick={() => {
      if (!window.confirm("Start a fresh fictional demo? This will delete your current demo and its changes.")) return;
      transition(async () => {
        setError(null);
        const result = await leaveDemo();
        if (result.ok) { router.replace("/demo"); router.refresh(); }
        else setError(result.error);
      });
    }}>{pending ? "Resetting…" : "Start fresh demo"}</button>
    {error && <p role="alert" className="mt-2 text-[13px] text-system-red">{error}</p>}
  </div>;
}
