import { cache } from "react";
import { appUserAllowed, isDemoMode } from "@/lib/demo/config";
import { createClient } from "./server";

/** Always ask Auth to verify the session; never authorize a submitted owner ID. */
export const getAppAuthUser = cache(async () => {
  const { data: { user }, error } = await (await createClient()).auth.getUser();
  if (error || !appUserAllowed(user, isDemoMode())) return null;
  if (isDemoMode()) {
    const { assertDemoInstallation } = await import("@/lib/demo/server");
    await assertDemoInstallation();
  }
  return user;
});
