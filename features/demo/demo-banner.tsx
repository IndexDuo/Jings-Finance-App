import Link from "next/link";

export function DemoBanner() {
  return <div className="mx-auto mt-3 flex w-full max-w-lg items-center justify-between gap-3 px-5 text-[12px] text-secondary-label">
    <span>Fictional demo · Your own copy</span>
    <Link href="/demo" className="text-system-blue">Demo home</Link>
  </div>;
}
