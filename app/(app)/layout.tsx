import { UserTimezoneProvider } from "@/components/ui/user-timezone";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { BottomNav } from "@/components/ui/bottom-nav";
import { PageTransition } from "@/components/ui/page-transition";
import { CalendarRefresh } from "@/components/ui/calendar-refresh";
import { todayInUserTz } from "@/lib/dates";
import { format } from "date-fns";
import { isDemoMode } from "@/lib/demo/config";
import { DemoBanner } from "@/features/demo/demo-banner";

export const dynamic = "force-dynamic";

// Gates every route under (app)/. Unauthenticated requests bounce to /login.
// Authenticated users without a settings row bounce to /onboarding
// (which lives outside this group, in (onboarding)/).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getVerifiedUser();

  if (!user) {
    redirect("/login");
  }

  const existing = await db
    .select({ userId: schema.settings.userId, timezone: schema.settings.timezone })
    .from(schema.settings)
    .where(eq(schema.settings.userId, user.id))
    .limit(1);

  if (existing.length === 0) {
    redirect("/onboarding");
  }

  return (
    <UserTimezoneProvider timezone={existing[0].timezone}>
      {isDemoMode() && <DemoBanner />}
      <CalendarRefresh renderedDate={format(todayInUserTz(existing[0].timezone), "yyyy-MM-dd")} />
      <PageTransition>{children}</PageTransition>
      <BottomNav />
    </UserTimezoneProvider>
  );
}
