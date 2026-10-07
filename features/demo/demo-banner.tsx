import Link from "next/link";

export function DemoBanner() {
  return <div className="mx-auto w-full max-w-lg border-b border-separator px-5 py-2 text-[13px] leading-5 text-secondary-label">
    <p>This is your own copy of the demo.</p>
    <p>Return to <Link href="/demo" className="rounded-sm text-system-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-system-blue">demo home</Link></p>
  </div>;
}
