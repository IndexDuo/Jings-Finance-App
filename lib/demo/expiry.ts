import type { User } from "@supabase/supabase-js";

export const DEMO_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Use verified Auth creation time, never editable user metadata or last sign-in. */
export function demoExpiresAt(user: Pick<User, "created_at">) {
  return Date.parse(user.created_at) + DEMO_LIFETIME_MS;
}

export function demoSessionActive(user: Pick<User, "is_anonymous" | "created_at">, now = Date.now()) {
  const createdAt = Date.parse(user.created_at);
  return user.is_anonymous === true && Number.isFinite(createdAt) &&
    createdAt <= now && now < demoExpiresAt(user);
}
