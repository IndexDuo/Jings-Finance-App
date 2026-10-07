import "server-only";

import { db, schema } from "@/lib/db";
import { cache } from "react";

import { getAppAuthUser } from "./app-user";
import { isDemoMode } from "@/lib/demo/config";

/** Return an ID only after Supabase has verified the session's JWT signature. */
export const getVerifiedUser = cache(async () => {
  const user = await getAppAuthUser();
  if (!user) return null;
  if (isDemoMode()) {
    const { ensureDemoDataset } = await import("@/lib/demo/server");
    await ensureDemoDataset(user);
    return { id: user.id };
  }
  // Password signup without email confirmation does not visit an auth callback.
  await db.insert(schema.users).values({ id: user.id, email: user.email! })
    .onConflictDoUpdate({ target: schema.users.id, set: { email: user.email } });
  return { id: user.id };
});
