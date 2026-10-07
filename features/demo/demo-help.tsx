"use client";

import { CircleHelp } from "lucide-react";
import { useCallback, useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";

export function DemoHelp() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={open}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-[13px] text-secondary-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-system-blue"
      onClick={() => setOpen(true)}>
      <CircleHelp size={20} aria-hidden="true" />
      What do these words mean?
    </button>
    <BottomSheet open={open} onClose={close} ariaLabel="Words used in the app" className="mx-auto max-w-lg" contentClassName="text-left">
      <div className="flex justify-end">
        <button type="button" onClick={close} className="min-h-11 rounded-lg px-2 font-semibold text-system-blue focus-visible:outline-2 focus-visible:outline-system-blue">Done</button>
      </div>
      <h2 className="mb-6 mt-2 text-[24px] font-bold">Words used in the app</h2>
      <dl className="space-y-6 pb-4 text-[16px] leading-relaxed">
        <div><dt className="font-semibold">Envelope</dt><dd>Money set aside for everyday spending, like groceries.</dd></div>
        <div><dt className="font-semibold">Plan</dt><dd>Work toward paying for something, like a trip or an unexpected bill.</dd></div>
        <div><dt className="font-semibold">Project</dt><dd>Keep related purchases together, like parts for a bike.</dd></div>
      </dl>
    </BottomSheet>
  </>;
}
