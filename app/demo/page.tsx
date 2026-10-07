import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_NAME } from "@/lib/app-info";
import { isDemoMode } from "@/lib/demo/config";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { StartDemo, ResetDemo } from "@/features/demo/demo-controls";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  if (!isDemoMode()) notFound();
  const user = await getVerifiedUser();
  return <main className="mx-auto w-full max-w-lg space-y-6 px-5 py-12">
    <p className="text-[13px] font-semibold text-system-blue">Interactive demo</p>
    <h1 className="text-3xl font-bold">{APP_NAME}</h1>
    <p>Try planning a paycheck with fictional money. Your copy starts with bills, envelopes, everyday purchases,
      a trip Plan, and Projects for a workspace and a bike upgrade.</p>
    <div className="rounded-2xl bg-secondary-system-grouped-background p-5 space-y-3 text-[15px]">
      <p>Make changes and explore the same screens as your own installation. Other visitors get their own copy.</p>
      <p>Your changes stay with this browser while your session remains available. Clearing browser data,
        resetting the demo, or using a different browser starts a fresh copy.</p>
      <p>Use fictional information only. This public demo is for exploring the app; host your own copy for personal finances.</p>
    </div>
    {user ? <div className="space-y-4">
      <Link href="/paycheck" className="block rounded-2xl bg-system-blue px-5 py-3 text-center font-semibold text-white">Continue my demo</Link>
      <div className="text-system-blue"><ResetDemo /></div>
    </div> : <StartDemo siteKey={process.env.DEMO_TURNSTILE_SITE_KEY} />}
    <p className="text-[13px] text-secondary-label">Start in Paycheck for the breakdown and history, log a purchase,
      or finish Home workspace to decide where its $375 of unused savings should go.</p>
  </main>;
}
