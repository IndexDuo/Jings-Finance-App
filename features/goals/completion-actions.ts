"use server";

import { actionError } from "@/lib/action-error";


import { getUserToday } from "@/lib/user-timezone";

import { z } from "zod";
import { format } from "date-fns";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

import { loadPlanCompletionPreview } from "./completion-server";
import { completePlan, completionPreviewKey } from "./complete-plan";

export async function previewPlanFinish(goalId: string) {
  if (!z.string().uuid().safeParse(goalId).success) return { ok: false as const, error: "Plan not found." };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const preview = await loadPlanCompletionPreview(user.id, goalId);
    if (!preview || preview.archived) return { ok: false as const, error: "Choose an active plan." };
    if (preview.status === "needs-review") return { ok: false as const, error: "This plan's funding needs review before it can be finished." };
    return { ok: true as const, preview, key: completionPreviewKey(preview) };
  } catch { return { ok: false as const, error: "Could not load the plan. Please try again." }; }
}

export async function finishPlan(input: unknown) {
  const parsed = z.object({ goalId: z.string().uuid(), key: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Review the plan before finishing." };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const receipt = await completePlan(user.id, parsed.data.goalId, parsed.data.key, format((await getUserToday(user.id)), "yyyy-MM-dd"));
    for (const path of ["/projects", "/goals", "/log", "/paycheck"]) revalidatePath(path, "layout");
    return { ok: true as const, releasedCents: receipt.releasedCents };
  } catch (e) { return { ok: false as const, error: actionError(e, "Could not finish the plan.") }; }
}
