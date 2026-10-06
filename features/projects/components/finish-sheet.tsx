"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { previewPlanFinish, finishPlan } from "@/features/goals/completion-actions";
import { money, primary, sheetWidth } from "./shared";

export function FinishSheet({ goalId, name, onClose }: { goalId: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const [result, setResult] = useState<Awaited<ReturnType<typeof previewPlanFinish>> | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => { let active = true;
    previewPlanFinish(goalId).then(r => { if (active) setResult(r); }).catch(() => { if (active) setError("Could not load the plan. Please try again."); });
    return () => { active = false; };
  }, [goalId]);
  const preview = result?.ok ? result.preview : null;
  return <BottomSheet open onClose={() => { if (!pending) onClose(); }} title={`Finish ${name}?`} className={sheetWidth} autoFocusFirstElement={false}>
    {!result && !error && <p className="py-4 text-secondary-label">Checking the totals…</p>}
    {preview && <div className="space-y-5">
      <dl className="space-y-3"><div className="flex justify-between"><dt>Spent</dt><dd className="tabular-nums">{money(preview.spentCents)}</dd></div>
        {preview.releaseCents > 0 && <div className="flex justify-between"><dt>Ready to reallocate</dt><dd className="font-semibold tabular-nums">{money(preview.releaseCents)}</dd></div>}
        {preview.remainingToCoverCents > 0 && <div className="flex justify-between"><dt>Still to cover</dt><dd className="tabular-nums">{money(preview.remainingToCoverCents)}</dd></div>}
      </dl>
      <p className="text-sm text-secondary-label">{preview.remainingToCoverCents > 0 ? "Spending will close. Future paychecks will continue covering the remaining amount." : preview.releaseCents > 0 ? "The leftover will be available to reallocate on Paycheck." : "Everything is covered. This project will move to Completed."}</p>
      <button disabled={pending} className={primary} onClick={() => start(async () => {
        try {
          const saved = await finishPlan({ goalId, key: result!.ok ? result!.key : "" });
          if (!saved.ok) setError(saved.error); else { router.refresh(); onClose(); }
        } catch { setError("Could not finish. Please try again."); }
      })}>{pending ? "Finishing…" : preview.releaseCents > 0 ? "Finish and release" : "Finish project"}</button>
    </div>}
    {(!result?.ok && result || error) && <p role="alert" className="mt-4 text-system-red">{error || (result && !result.ok ? result.error : "")}</p>}
  </BottomSheet>;
}
