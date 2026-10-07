import type { User } from "@supabase/supabase-js";

/** Server deployment setting. Ordinary installations remain email/password apps. */
export function isDemoMode() {
  return process.env.FINANCE_DEMO_MODE === "true";
}

export function appUserAllowed(user: Pick<User, "is_anonymous" | "email"> | null, demo: boolean) {
  if (!user) return false;
  return demo ? user.is_anonymous === true : user.is_anonymous !== true && Boolean(user.email);
}
