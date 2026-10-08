"use server";

import { z } from "zod";
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
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
    await assertDemoInstallation();
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error && !isAuthSessionMissingError(error) &&
      !(isAuthApiError(error) && [401, 403, 404].includes(error.status))) throw error;
    if (user && user.is_anonymous !== true) throw new Error("Only anonymous demo copies can be reset.");
    if (user) {
      // This action accepts no owner ID. Delete only the identity verified by Auth.
      // Deletion also revokes every session and removes its immutable demo history.
      await db.execute(sql`SELECT finance_private.erase_demo_users(ARRAY[${user.id}::uuid])`);
    }
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    // After deletion, a temporary logout API error cannot restore the old copy.
    // Demo home will verify Auth again, and a new start replaces the stale cookie.
    if (signOutError && !user) throw signOutError;
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Could not reset this demo session. Please try again." };
  }
}
