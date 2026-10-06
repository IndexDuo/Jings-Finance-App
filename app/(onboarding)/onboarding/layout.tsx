import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";
import { getVerifiedUser } from "@/lib/supabase/verified-user";

export const dynamic = "force-dynamic";

// Auth gate for the onboarding wizard. Lives outside (app)/ so the settings
// gate in that layout can redirect here without looping.
// If the user already has a settings row, they're past onboarding → bounce to /paycheck.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await getVerifiedUser();

  if (!user) {
    redirect("/login");
  }

  const existing = await db
    .select({ userId: schema.settings.userId })
    .from(schema.settings)
    .where(eq(schema.settings.userId, user.id))
    .limit(1);

  if (existing.length > 0) {
    redirect("/paycheck");
  }

  return <>{children}</>;
}
