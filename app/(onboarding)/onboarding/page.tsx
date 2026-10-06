import { eq } from "drizzle-orm";
import { format } from "date-fns";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { todayInUserTz } from "@/lib/dates";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { OnboardingWizard } from "./wizard";
export default async function OnboardingPage() {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");
  const existing = await db.select({ id: schema.settings.userId }).from(schema.settings).where(eq(schema.settings.userId,user.id)).limit(1);
  if (existing.length) redirect("/paycheck");
  return <OnboardingWizard todayIso={format(todayInUserTz("UTC"), "yyyy-MM-dd")} />;
}
