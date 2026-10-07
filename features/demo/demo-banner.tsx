import Link from "next/link";

export function DemoBanner() {
  return <aside aria-label="Demo information" className="w-full py-4 text-center text-[13px] leading-5 text-secondary-label">
    <p>This is your own copy of the demo.</p>
    <p>Return to <Link href="/demo" className="rounded-sm text-system-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-system-blue">demo home</Link></p>
  </aside>;
}
