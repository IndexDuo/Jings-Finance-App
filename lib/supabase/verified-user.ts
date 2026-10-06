import "server-only";

import { db, schema } from "@/lib/db";
import { cache } from "react";

import { createClient } from "./server";

/** Return an ID only after Supabase has verified the session's JWT signature. */
export const getVerifiedUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email) return null;
  // Password signup without email confirmation does not visit an auth callback.
  await db.insert(schema.users).values({ id: user.id, email: user.email })
    .onConflictDoUpdate({ target: schema.users.id, set: { email: user.email } });
  return { id: user.id };
});
