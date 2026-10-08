"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/config";
import { demoSessionActive } from "@/lib/demo/expiry";
import { assertDemoInstallation, ensureDemoDataset } from "@/lib/demo/server";

export async function startDemo(input: unknown) {
  if (!isDemoMode()) return { ok: false as const, error: "This installation is not a demo." };
  const parsed = z.object({ captchaToken: z.string().max(4096).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Please try starting the demo again." };
  try {
    await assertDemoInstallation();
    const supabase = await createClient();
    let { data: { user } } = await supabase.auth.getUser();
    if (user?.is_anonymous && !demoSessionActive(user)) {
      await supabase.auth.signOut({ scope: "local" });
      user = null;
    }
    if (!user?.is_anonymous) {
      if (process.env.DEMO_TURNSTILE_SITE_KEY && !parsed.data.captchaToken)
        return { ok: false as const, error: "Complete the visitor check first." };
      const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken: parsed.data.captchaToken } });
      if (error) return { ok: false as const, error: "Could not start a demo session. Try again in a little while." };
      ({ data: { user } } = await supabase.auth.getUser());
    }
    if (!user || !demoSessionActive(user)) return { ok: false as const, error: "Could not verify your demo session. Please try again." };
    await ensureDemoDataset(user);
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "The demo could not load. Please try again later." };
  }
}

export async function leaveDemo() {
  if (!isDemoMode()) return { ok: false as const, error: "This installation is not a demo." };
  try {
    const { error } = await (await createClient()).auth.signOut({ scope: "local" });
    if (error) return { ok: false as const, error: "Could not reset this demo session. Please try again." };
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Could not reset this demo session. Please try again." };
  }
}
