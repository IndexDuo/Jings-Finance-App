import { z } from "zod";
import { isValidTimezone, parseLocalIsoDate } from "@/lib/dates";

// Money inputs are integer USD cents.
const centsSchema = z.number().int().nonnegative().max(2_147_483_647);

// Optional `id` on input rows lets settings save be diff-update instead of
// wipe-and-reinsert. Preserving envelope IDs across saves prevents transactions'
// `envelope_id` FK (ON DELETE SET NULL) from getting orphaned.
const optionalUuid = z.string().uuid().optional();
const fixedDateSchema = z
  .string()
  .refine(value => { try { parseLocalIsoDate(value); return true; } catch { return false; } }, "Use a valid YYYY-MM-DD date");

export const fixedExpenseInputSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1).max(64),
  amountCents: centsSchema.min(1),
  frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "biannual", "annual"]),
  dueDay: z.number().int().min(1).max(31).nullable(),
  lastPaidDate: fixedDateSchema.nullable().optional(),
  nextDueDate: fixedDateSchema.nullable().optional(),
});

export const envelopeInputSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1).max(64),
  periodAmountCents: centsSchema,
  period: z.enum(["weekly", "monthly"]),
  category: z.enum(["variable", "guilt-free"]),
  rolloverBehavior: z.enum(["reset", "accumulate"]),
  // Optional target envelope id for over-budget spend to overflow into
  // (e.g. dining-out → groceries). Null = no routing.
  overflowEnvelopeId: z.string().uuid().nullable().optional(),
  // 'recurring' = part of every paycheck plan. 'one-time' = appears in /log
  // dropdown for tagging existing spend, but skipped by paycheck waterfall.
  recurrence: z.enum(["recurring", "one-time"]).default("recurring"),
}).superRefine((env, ctx) => {
  if (env.recurrence === "recurring" && env.periodAmountCents < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["periodAmountCents"],
      message: "Recurring envelopes need an allowance. Use one-time for $0 surprises.",
    });
  }
});

const isoDateSchema = z.string().refine(value => {
  try { parseLocalIsoDate(value); return true; } catch { return false; }
}, "Use a valid YYYY-MM-DD date");

export const onboardingInputSchema = z.object({
  takeHomeCents: centsSchema.min(1),
  payAnchorDate: isoDateSchema,
  payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
  semimonthlyDays: z.tuple([z.number().int().min(1).max(27), z.number().int().min(2).max(31)])
    .refine(([first, second]) => first < second, "Paydays must be different and in order").default([15, 31]),
  timezone: z.string().refine(isValidTimezone, "Choose a valid IANA timezone").default("UTC"),
  trackingStartDate: isoDateSchema.optional(),
  fixedExpenses: z.array(fixedExpenseInputSchema).max(30),
  envelopes: z.array(envelopeInputSchema).max(20),
});
export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
export type FixedExpenseInput = z.infer<typeof fixedExpenseInputSchema>;
export type EnvelopeInput = z.infer<typeof envelopeInputSchema>;
