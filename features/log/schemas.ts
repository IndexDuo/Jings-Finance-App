import { z } from "zod";
import { calendarDateSchema } from "@/lib/date-schema";

// Transaction kinds drive both UI grouping and sign convention.
// - income → amountCents > 0 (money in)
// - fixed | variable | guilt-free → amountCents < 0 (money out)
// - note → amountCents === 0 (free-form)
export const transactionCategorySchema = z.enum([
  "income",
  "fixed",
  "variable",
  "guilt-free",
  "note",
]);

export type TransactionCategory = z.infer<typeof transactionCategorySchema>;

const isoDateSchema = calendarDateSchema;

const uuidSchema = z.string().uuid();

// "+ New envelope" inline-create: when picked, the form sends the desired
// name and the server creates the envelope in the same transaction as the
// txn. envelopeId must be empty when this is set.
const newEnvelopeNameSchema = z.string().trim().min(1).max(64).optional();

function refineEnvelopeFields(
  v: { envelopeId?: string | null; newEnvelopeName?: string; category: string },
  ctx: z.RefinementCtx,
) {
  if (v.newEnvelopeName && v.envelopeId) {
    ctx.addIssue({
      code: "custom",
      path: ["newEnvelopeName"],
      message: "Pick an existing envelope or create a new one — not both",
    });
  }
  if (
    v.newEnvelopeName &&
    v.category !== "variable" &&
    v.category !== "guilt-free"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["newEnvelopeName"],
      message: "New envelopes are only valid for variable and guilt-free txns",
    });
  }
  if (
    v.envelopeId &&
    v.category !== "variable" &&
    v.category !== "guilt-free"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["envelopeId"],
      message: "Only variable and guilt-free spending can use an envelope",
    });
  }
}

export const addTransactionInputSchema = z
  .object({
    requestId: uuidSchema.optional(),
    date: isoDateSchema,
    amountCents: z.number().int(),
    category: transactionCategorySchema,
    envelopeId: uuidSchema.nullable().optional(),
    newEnvelopeName: newEnvelopeNameSchema,
    fixedExpenseId: uuidSchema.nullable().optional(),
    fixedExpenseDueDate: isoDateSchema.nullable().optional(),
    paymentMethod: z.enum(["cash", "credit"]).default("cash"),
    fundingStatus: z.enum(["covered", "needs-future-money"]).default("covered"),
    goalId: uuidSchema.nullable().optional(),
    projectEntry: z.boolean().optional(),
    projectGroupId: uuidSchema.nullable().optional(),
    creditPlanType: z.enum(["card-payoff", "checking-recovery"]).default("card-payoff"),
    recoveryTarget: z.enum(["checking", "emergency-fund", "other"]).default("checking"),
    recoveryTargetLabel: z.string().trim().max(64).nullable().optional(),
    creditCardDueDate: isoDateSchema.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.category === "income" && v.amountCents <= 0) {
      ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Income must be positive" });
    }
    if (
      (v.category === "fixed" || v.category === "variable" || v.category === "guilt-free") &&
      v.amountCents >= 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["amountCents"],
        message: "Expenses must be negative (signed)",
      });
    }
    if (v.category === "note" && v.amountCents !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["amountCents"],
        message: "Notes carry no amount",
      });
    }
    if (v.category === "note" && (!v.note || v.note.trim() === "")) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Notes need some text" });
    }
    if (v.fundingStatus === "needs-future-money" && !v.creditCardDueDate) {
      ctx.addIssue({
        code: "custom",
        path: ["creditCardDueDate"],
        message: "Add the payoff or recovery date",
      });
    }
    if (
      (v.category === "variable" || v.category === "guilt-free") &&
      !v.envelopeId &&
      !v.newEnvelopeName &&
      (!v.note || v.note.trim() === "")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Describe this one-time purchase",
      });
    }
    if (
      v.paymentMethod === "credit" &&
      (v.category === "income" || v.category === "note")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentMethod"],
        message: "Only expenses can create a card payoff",
      });
    }
    if (v.goalId && (v.category === "income" || v.category === "note")) {
      ctx.addIssue({
        code: "custom",
        path: ["goalId"],
        message: "Only expenses can count toward a savings plan",
      });
    }
    if (v.fixedExpenseId && !v.fixedExpenseDueDate) {
      ctx.addIssue({
        code: "custom",
        path: ["fixedExpenseDueDate"],
        message: "Linked bills need their due date",
      });
    }
    if (v.fixedExpenseId && v.category !== "fixed") {
      ctx.addIssue({
        code: "custom",
        path: ["fixedExpenseId"],
        message: "A linked bill must use the Fixed category",
      });
    }
    refineEnvelopeFields(v, ctx);
  });

export type AddTransactionInput = z.infer<typeof addTransactionInputSchema>;

export const deleteTransactionInputSchema = z.object({
  id: uuidSchema,
});

export const updateTransactionInputSchema = z
  .object({
    id: uuidSchema,
    date: isoDateSchema,
    amountCents: z.number().int(),
    category: transactionCategorySchema,
    envelopeId: uuidSchema.nullable().optional(),
    newEnvelopeName: newEnvelopeNameSchema,
    fixedExpenseId: uuidSchema.nullable().optional(),
    fixedExpenseDueDate: isoDateSchema.nullable().optional(),
    paymentMethod: z.enum(["cash", "credit"]).default("cash"),
    fundingStatus: z.enum(["covered", "needs-future-money"]).default("covered"),
    goalId: uuidSchema.nullable().optional(),
    projectEntry: z.boolean().optional(),
    projectGroupId: uuidSchema.nullable().optional(),
    creditPlanType: z.enum(["card-payoff", "checking-recovery"]).default("card-payoff"),
    recoveryTarget: z.enum(["checking", "emergency-fund", "other"]).default("checking"),
    recoveryTargetLabel: z.string().trim().max(64).nullable().optional(),
    creditCardDueDate: isoDateSchema.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.category === "income" && v.amountCents <= 0) {
      ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Income must be positive" });
    }
    if (
      (v.category === "fixed" || v.category === "variable" || v.category === "guilt-free") &&
      v.amountCents >= 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["amountCents"],
        message: "Expenses must be negative (signed)",
      });
    }
    if (v.category === "note" && v.amountCents !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["amountCents"],
        message: "Notes carry no amount",
      });
    }
    if (v.category === "note" && (!v.note || v.note.trim() === "")) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Notes need some text" });
    }
    if (v.fundingStatus === "needs-future-money" && !v.creditCardDueDate) {
      ctx.addIssue({
        code: "custom",
        path: ["creditCardDueDate"],
        message: "Add the payoff or recovery date",
      });
    }
    if (
      (v.category === "variable" || v.category === "guilt-free") &&
      !v.envelopeId &&
      !v.newEnvelopeName &&
      (!v.note || v.note.trim() === "")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Describe this one-time purchase",
      });
    }
    if (
      v.paymentMethod === "credit" &&
      (v.category === "income" || v.category === "note")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentMethod"],
        message: "Only expenses can create a card payoff",
      });
    }
    if (v.goalId && (v.category === "income" || v.category === "note")) {
      ctx.addIssue({
        code: "custom",
        path: ["goalId"],
        message: "Only expenses can count toward a savings plan",
      });
    }
    if (v.fixedExpenseId && !v.fixedExpenseDueDate) {
      ctx.addIssue({
        code: "custom",
        path: ["fixedExpenseDueDate"],
        message: "Linked bills need their due date",
      });
    }
    if (v.fixedExpenseId && v.category !== "fixed") {
      ctx.addIssue({
        code: "custom",
        path: ["fixedExpenseId"],
        message: "A linked bill must use the Fixed category",
      });
    }
    refineEnvelopeFields(v, ctx);
  });

export type UpdateTransactionInput = z.infer<typeof updateTransactionInputSchema>;
