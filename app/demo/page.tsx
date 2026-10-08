import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_NAME } from "@/lib/app-info";
import { isDemoMode } from "@/lib/demo/config";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { StartDemo, ResetDemo } from "@/features/demo/demo-controls";
import { DemoHelp } from "@/features/demo/demo-help";
import { DemoDeviceNotice } from "@/features/demo/demo-device-notice";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  if (!isDemoMode()) notFound();
  const user = await getVerifiedUser();
  return <DemoDeviceNotice>
    <h1 className="text-[28px] font-bold leading-tight tracking-tight">{APP_NAME}</h1>
    <p className="mx-auto mt-6 max-w-sm text-[17px] leading-relaxed">
      See where your money goes, what you can spend, and what’s left to invest.
    </p>
    <div className="mt-12">
      {user ? <div className="space-y-4">
        <Link href="/log" className="block rounded-2xl bg-system-blue px-5 py-4 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-system-blue">Continue demo</Link>
        <div className="text-[15px] text-[#52739A]"><ResetDemo /></div>
      </div> : <>
        <StartDemo siteKey={process.env.DEMO_TURNSTILE_SITE_KEY} />
        <p className="mt-4 text-[13px] text-secondary-label">Try it with made-up money.</p>
      </>}
    </div>
    <p className="mx-auto mt-6 max-w-sm text-[13px] leading-relaxed text-secondary-label">
      Your demo copy lasts 12 hours. After that, your changes are deleted. Start again with fresh example data.
    </p>
    <div className="mt-12"><DemoHelp /></div>
  </DemoDeviceNotice>;
}
