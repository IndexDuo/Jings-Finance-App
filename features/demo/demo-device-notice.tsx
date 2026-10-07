"use client";

import { Smartphone } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { APP_NAME } from "@/lib/app-info";

export function DemoDeviceNotice({ children }: { children: ReactNode }) {
  const [proceeded, setProceeded] = useState(false);
  const home = useRef<HTMLDivElement>(null);

  function proceed() {
    setProceeded(true);
    requestAnimationFrame(() => home.current?.focus());
  }

  return <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-14 text-center">
    {!proceeded && <section className="hidden min-[601px]:block" aria-labelledby="demo-device-title">
      <Smartphone className="mx-auto mb-6 h-12 w-12 text-system-blue" aria-hidden="true" />
      <h1 id="demo-device-title" className="text-[32px] font-bold leading-tight tracking-tight">Best used on a phone</h1>
      <p className="mx-auto mt-6 max-w-sm text-[17px] leading-relaxed">
        {APP_NAME} was built for phone screens. Open the demo on your phone, or keep going here.
      </p>
      <button type="button" onClick={proceed} className="mt-10 w-full rounded-2xl bg-system-blue px-5 py-4 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-system-blue">
        Proceed anyway
      </button>
    </section>}
    <div ref={home} tabIndex={-1} className={proceeded ? "outline-none" : "outline-none min-[601px]:hidden"}>
      {children}
    </div>
  </main>;
}
