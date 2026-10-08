"use client";

import { useEffect } from "react";

/** Also catches a phone waking up or a suspended browser tab becoming visible. */
export function DemoExpiration({ expiresAt, serverNow }: { expiresAt: number; serverNow: number }) {
  useEffect(() => {
    let disposed = false;
    let checking = false;
    // A device with the wrong date must not get an extra twelve hours.
    const deadline = performance.now() + Math.max(0, expiresAt - serverNow);
    function checkExpiry() {
      if (performance.now() >= deadline) window.location.replace("/demo");
    }
    checkExpiry();
    const timer = window.setTimeout(checkExpiry, Math.max(0, deadline - performance.now()));
    // Some browsers pause their monotonic clock while the device sleeps. Ask
    // the server on return as well; the server always checks the actual age.
    async function checkOnReturn() {
      checkExpiry();
      if (document.hidden || checking) return;
      checking = true;
      try {
        const response = await fetch("/api/demo-session", { cache: "no-store" });
        if (response.ok && !(await response.json()).active && !disposed) window.location.replace("/demo");
      } catch { /* Being offline does not extend the server's expiry. */ }
      finally { checking = false; }
    }
    window.addEventListener("focus", checkOnReturn);
    window.addEventListener("pageshow", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkOnReturn);
      window.removeEventListener("pageshow", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
    };
  }, [expiresAt, serverNow]);
  return null;
}
