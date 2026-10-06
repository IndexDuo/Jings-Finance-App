"use server";

import { PublicActionError, actionError } from "@/lib/action-error";


import { getUserToday } from "@/lib/user-timezone";

import { format } from "date-fns";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";

import { createClient } from "@/lib/supabase/server";
import { lockAllocationOwner } from "@/features/allocations/server";
import { incomeEditError } from "@/features/allocations/lib/sources";
import { fundProjectPurchase, returnPurchaseFunding } from "@/features/projects/purchase-funding";
import {
    detachFixedExpensePayment,
    linkFixedExpensePayment,
} from "@/features/fixed-expenses/payment-ledger";

import {
    addTransactionInputSchema,
    deleteTransactionInputSchema,
    updateTransactionInputSchema,
} from "./schemas";

export type MutateResult = { ok: true } | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
}

// Defaults for inline-created envelopes (the "+ New envelope" path on the
// add-tx form). User can refine name, period, amount, rollover later in
// Settings — but the envelope is real and persistent from creation.
const NEW_ENVELOPE_DEFAULT_AMOUNT_CENTS = 0;
const NEW_ENVELOPE_DEFAULT_PERIOD = "monthly" as const;
const NEW_ENVELOPE_DEFAULT_ROLLOVER = "reset" as const;

function piggyImpact(amountCents: number): number {
    return amountCents < 0 ? -Math.abs(amountCents) : 0;
}

async function isPiggyEnvelope(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    args: { userId: string; envelopeId: string | null },
): Promise<boolean> {
    if (!args.envelopeId) return false;
    const [row] = await tx
        .select({ isPiggy: schema.envelopes.isPiggy })
        .from(schema.envelopes)
        .where(
            and(
                eq(schema.envelopes.userId, args.userId),
                eq(schema.envelopes.id, args.envelopeId),
            ),
        )
        .limit(1);
    return row?.isPiggy ?? false;
}

async function validateEnvelopeCategory(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    args: {
        userId: string;
        envelopeId: string | null;
        category: string;
        date: string;
    },
): Promise<void> {
    if (!args.envelopeId) return;
    const configuration = await loadFinancialConfiguration(args.userId, tx);
    const envelope = configuration.at(args.date).envelopes.find(e => e.id === args.envelopeId);
    if (!envelope) throw new PublicActionError("That envelope no longer exists");
    const expectedCategory = envelope.isPiggy
        ? "guilt-free"
        : envelope.category;
    if (args.category !== expectedCategory) {
        throw new PublicActionError(
            `That envelope belongs to ${expectedCategory}, not ${args.category}`,
        );
    }
}

async function applyPiggyDelta(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    args: { userId: string; deltaCents: number },
): Promise<void> {
    if (args.deltaCents === 0) return;
    const [settings] = await tx
        .select({ piggyBankCents: schema.settings.piggyBankCents })
        .from(schema.settings)
        .where(eq(schema.settings.userId, args.userId))
        .limit(1);
    if (!settings) throw new PublicActionError("Settings are missing");
    if (settings.piggyBankCents + args.deltaCents < 0) {
        throw new PublicActionError(
            `Piggy only has $${(settings.piggyBankCents / 100).toFixed(2)} available`,
        );
    }
    await tx
        .update(schema.settings)
        .set({
            piggyBankCents: sql`${schema.settings.piggyBankCents} + ${args.deltaCents}`,
        })
        .where(eq(schema.settings.userId, args.userId));
}

// Resolve the envelope id for a txn write. If the user picked "+ New envelope"
// in the form, we INSERT the envelope first (in the same DB transaction) and
// return its fresh id. Otherwise we pass through the picked id (or null).
async function resolveEnvelopeId(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    args: {
        userId: string;
        envelopeId: string | null | undefined;
        newEnvelopeName: string | undefined;
        category: "variable" | "guilt-free" | (string & {});
        date: string;
    },
): Promise<string | null> {
    if (!args.newEnvelopeName) {
        return args.envelopeId ?? null;
    }
    // Schema already guarded category; double-check at runtime as belt-and-braces.
    if (args.category !== "variable" && args.category !== "guilt-free") {
        return null;
    }
    const [inserted] = await tx
        .insert(schema.envelopes)
        .values({
            userId: args.userId,
            name: args.newEnvelopeName,
            periodAmountCents: NEW_ENVELOPE_DEFAULT_AMOUNT_CENTS,
            period: NEW_ENVELOPE_DEFAULT_PERIOD,
            category: args.category,
            rolloverBehavior: NEW_ENVELOPE_DEFAULT_ROLLOVER,
            // Inline-created envelopes are usually for unexpected one-off spend
            // (e.g. a single car wash). Default to one-time so they don't muscle
            // into the paycheck plan; the user can flip to recurring in Settings.
            recurrence: "one-time",
            accrualStartDate: args.date,
        })
        .returning({ id: schema.envelopes.id });
    await tx.insert(schema.envelopePolicyVersions).values({
        userId: args.userId,
        envelopeId: inserted.id,
        effectiveDate: args.date,
        periodAmountCents: NEW_ENVELOPE_DEFAULT_AMOUNT_CENTS,
        period: NEW_ENVELOPE_DEFAULT_PERIOD,
        category: args.category,
        rolloverBehavior: NEW_ENVELOPE_DEFAULT_ROLLOVER,
        recurrence: "one-time",
    });
    return inserted.id;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function syncCreditCardCommitment(
    tx: DbTransaction,
    args: {
        userId: string;
        transactionId: string;
        paymentMethod: "cash" | "credit";
        fundingStatus: "covered" | "needs-future-money";
        creditPlanType: "card-payoff" | "checking-recovery";
        recoveryTarget: "checking" | "emergency-fund" | "other";
        recoveryTargetLabel: string | null | undefined;
        dueDate: string | null | undefined;
        amountCents: number;
        note: string | null | undefined;
    },
) {
    const shouldCreatePriorityPlan =
        args.fundingStatus === "needs-future-money" &&
        Boolean(args.dueDate) &&
        Math.abs(args.amountCents) > 0;
    if (shouldCreatePriorityPlan && args.dueDate) {
        const label =
            args.note?.trim() ||
            (args.paymentMethod === "credit"
                ? "Credit card expense"
                : "Unexpected expense recovery");
        const configuration = await loadFinancialConfiguration(args.userId, tx);
        const defaultStartPaycheck = configuration.period(format((await getUserToday(args.userId, tx)), "yyyy-MM-dd")).next;
        await tx
            .insert(schema.creditCardCommitments)
            .values({
                userId: args.userId,
                sourceTransactionId: args.transactionId,
                name: label,
                purpose: args.creditPlanType,
                recoveryTarget: args.recoveryTarget,
                recoveryTargetLabel:
                    args.recoveryTarget === "other"
                        ? (args.recoveryTargetLabel?.trim() || "Other reserve")
                        : null,
                originalCents: Math.abs(args.amountCents),
                dueDate: args.dueDate,
                startDate: defaultStartPaycheck,
            })
            .onConflictDoUpdate({
                target: schema.creditCardCommitments.sourceTransactionId,
                set: {
                    name: label,
                    purpose: args.creditPlanType,
                    recoveryTarget: args.recoveryTarget,
                    recoveryTargetLabel:
                        args.recoveryTarget === "other"
                            ? (args.recoveryTargetLabel?.trim() || "Other reserve")
                            : null,
                    originalCents: Math.abs(args.amountCents),
                    dueDate: args.dueDate,
                    archivedAt: null,
                },
            });
        return;
    }

    await tx
        .update(schema.creditCardCommitments)
        .set({ archivedAt: new Date() })
        .where(
            and(
                eq(schema.creditCardCommitments.userId, args.userId),
                eq(
                    schema.creditCardCommitments.sourceTransactionId,
                    args.transactionId,
                ),
            ),
        );
}

async function validateGoal(
    tx: DbTransaction,
    args: { userId: string; goalId: string | null | undefined },
) {
    if (!args.goalId) return;
    const [goal] = await tx
        .select({ id: schema.goals.id })
        .from(schema.goals)
        .where(
            and(
                eq(schema.goals.id, args.goalId),
                eq(schema.goals.userId, args.userId),
                isNull(schema.goals.archivedAt),
            ),
        )
        .limit(1);
    if (!goal) throw new PublicActionError("Choose an active savings plan");
}

export async function addTransaction(input: unknown): Promise<MutateResult> {
    const parsed = addTransactionInputSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join("; "),
        };
    }
    const userId = await requireUserId();
    if (!userId) return { ok: false, error: "Not signed in" };

    const {
        date,
        amountCents,
        category,
        envelopeId,
        newEnvelopeName,
        fixedExpenseId,
        fixedExpenseDueDate,
        paymentMethod,
        fundingStatus,
        goalId,
        creditPlanType,
        recoveryTarget,
        recoveryTargetLabel,
        creditCardDueDate,
        note,
    } = parsed.data;

    try {
        await db.transaction(async (tx) => {
        await lockAllocationOwner(tx, userId);
        if (parsed.data.requestId) {
            const [saved] = await tx.select().from(schema.transactions).where(eq(schema.transactions.id, parsed.data.requestId));
            if (saved) {
                if (saved.userId === userId && saved.goalId === (goalId ?? null) && saved.amountCents === amountCents && saved.note === (note ?? null) && saved.paymentMethod === paymentMethod && saved.category === category) return;
                throw new PublicActionError("This entry was already saved. Reopen it to make changes.");
            }
        }
        if (parsed.data.projectEntry && (category !== "variable" || envelopeId || newEnvelopeName || fixedExpenseId))
            throw new PublicActionError("Project purchases use their plan, not an envelope or fixed bill.");
        const resolvedEnvelopeId = await resolveEnvelopeId(tx, {
            userId,
            envelopeId,
            newEnvelopeName,
            category,
            date,
        });
        await validateEnvelopeCategory(tx, {
            date,
            userId,
            envelopeId: resolvedEnvelopeId,
            category,
        });
        await validateGoal(tx, { userId, goalId });

        const isPiggy = await isPiggyEnvelope(tx, {
            userId,
            envelopeId: resolvedEnvelopeId,
        });

        const [transaction] = await tx
            .insert(schema.transactions)
            .values({
                id: parsed.data.requestId,
                userId,
                date,
                amountCents,
                category,
                envelopeId: resolvedEnvelopeId,
                fixedExpenseId: fixedExpenseId ?? null,
                fixedExpenseDueDate: fixedExpenseDueDate ?? null,
                paymentMethod,
                fundingStatus,
                goalId: goalId ?? null,
                note: note ?? null,
            })
            .returning({ id: schema.transactions.id });

        const projectFunding = await fundProjectPurchase(tx, { userId, id: transaction.id, goalId, amountCents,
            projectEntry: parsed.data.projectEntry, groupId: parsed.data.projectGroupId });
        const priorityPlanAmountCents = projectFunding ? -projectFunding.shortfall : amountCents;
        if (fixedExpenseId && fixedExpenseDueDate) {
            await linkFixedExpensePayment(tx, {
                userId,
                transactionId: transaction.id,
                fixedExpenseId,
                dueDate: fixedExpenseDueDate,
                paidDate: date,
                actualCents: Math.abs(amountCents),
                note: `Logged ${note?.trim() || "saved bill"} manually`,
            });
        }

        if (!fixedExpenseId) await syncCreditCardCommitment(tx, {
            userId,
            transactionId: transaction.id,
            paymentMethod,
            fundingStatus: projectFunding?.fundingStatus ?? fundingStatus,
            creditPlanType,
            recoveryTarget,
            recoveryTargetLabel,
            dueDate: creditCardDueDate ?? (projectFunding?.shortfall ? (await loadFinancialConfiguration(userId, tx)).period(format((await getUserToday(userId, tx)), "yyyy-MM-dd")).next : null),
            amountCents: priorityPlanAmountCents,
            note,
        });

        if (isPiggy) {
            await applyPiggyDelta(tx, {
                userId,
                deltaCents: piggyImpact(amountCents),
            });
        }
        });
    } catch (error) {
        return {
            ok: false,
            error: actionError(error, "Could not save transaction"),
        };
    }

    revalidatePath("/log");
    revalidatePath("/paycheck");
    revalidatePath("/goals");
  revalidatePath("/projects", "layout");
    return { ok: true };
}

export async function updateTransaction(input: unknown): Promise<MutateResult> {
    const parsed = updateTransactionInputSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join("; "),
        };
    }
    const userId = await requireUserId();
    if (!userId) return { ok: false, error: "Not signed in" };

    const {
        id,
        date,
        amountCents,
        category,
        envelopeId,
        newEnvelopeName,
        fixedExpenseId,
        fixedExpenseDueDate,
        paymentMethod,
        fundingStatus,
        goalId,
        creditPlanType,
        recoveryTarget,
        recoveryTargetLabel,
        creditCardDueDate,
        note,
    } = parsed.data;

    try {
        await db.transaction(async (tx) => {
        await lockAllocationOwner(tx, userId);
        const [existing] = await tx
            .select({
                date: schema.transactions.date,
                amountCents: schema.transactions.amountCents,
                envelopeId: schema.transactions.envelopeId,
                fixedExpenseId: schema.transactions.fixedExpenseId,
                fixedExpenseDueDate: schema.transactions.fixedExpenseDueDate,
                goalId: schema.transactions.goalId,
                planFundingCents: schema.transactions.planFundingCents,
            })
            .from(schema.transactions)
            .where(
                and(
                    eq(schema.transactions.id, id),
                    eq(schema.transactions.userId, userId),
                ),
            )
            .limit(1);

        if (!existing) throw new PublicActionError("Transaction not found");
        if (existing.planFundingCents !== null && (category !== "variable" || envelopeId || newEnvelopeName || fixedExpenseId))
            throw new PublicActionError("This purchase uses plan savings. Keep it as a plan expense.");

        const assigned = await tx.select({ amountCents: schema.paycheckAllocations.amountCents })
            .from(schema.paycheckAllocations).where(and(eq(schema.paycheckAllocations.userId, userId), eq(schema.paycheckAllocations.incomeTransactionId, id)));
        const allocationError = incomeEditError({ allocatedCents: assigned.reduce((sum, row) => sum + row.amountCents, 0), existingDate: existing.date, next: { date, category, amountCents } });
        if (allocationError) throw new PublicActionError(allocationError);

        const resolvedEnvelopeId = await resolveEnvelopeId(tx, {
            userId,
            envelopeId,
            newEnvelopeName,
            category,
            date,
        });
        await validateEnvelopeCategory(tx, {
            date,
            userId,
            envelopeId: resolvedEnvelopeId,
            category,
        });
        await validateGoal(tx, { userId, goalId });

        const wasPiggy = await isPiggyEnvelope(tx, {
            userId,
            envelopeId: existing.envelopeId,
        });
        const isPiggy = await isPiggyEnvelope(tx, {
            userId,
            envelopeId: resolvedEnvelopeId,
        });

        await tx
            .update(schema.transactions)
            .set({
                planFundingCents: existing.planFundingCents !== null ? null : undefined,
                date,
                amountCents,
                category,
                envelopeId: resolvedEnvelopeId,
                fixedExpenseId: fixedExpenseId ?? null,
                fixedExpenseDueDate: fixedExpenseDueDate ?? null,
                paymentMethod,
                fundingStatus,
                goalId: goalId ?? null,
                note: note ?? null,
            })
            .where(
                and(
                    eq(schema.transactions.id, id),
                    eq(schema.transactions.userId, userId),
                ),
            );

        const projectFunding = await fundProjectPurchase(tx, { userId, id, goalId, amountCents, previous: existing,
            projectEntry: parsed.data.projectEntry, groupId: parsed.data.projectGroupId });
        const priorityPlanAmountCents = projectFunding ? -projectFunding.shortfall : amountCents;
        if (fixedExpenseId && fixedExpenseDueDate) {
            await linkFixedExpensePayment(tx, {
                userId,
                transactionId: id,
                fixedExpenseId,
                dueDate: fixedExpenseDueDate,
                paidDate: date,
                actualCents: Math.abs(amountCents),
                note: "Edited linked Log entry",
            });
        } else if (existing.fixedExpenseId && existing.fixedExpenseDueDate) {
            await detachFixedExpensePayment(tx, {
                userId,
                transactionId: id,
                paidDate: date,
                note: "Log entry changed to a one-time fixed expense",
            });
        }

        if (!fixedExpenseId) await syncCreditCardCommitment(tx, {
            userId,
            transactionId: id,
            paymentMethod,
            fundingStatus: projectFunding?.fundingStatus ?? fundingStatus,
            creditPlanType,
            recoveryTarget,
            recoveryTargetLabel,
            dueDate: creditCardDueDate ?? (projectFunding?.shortfall ? (await loadFinancialConfiguration(userId, tx)).period(format((await getUserToday(userId, tx)), "yyyy-MM-dd")).next : null),
            amountCents: priorityPlanAmountCents,
            note,
        });

        const delta =
            (isPiggy ? piggyImpact(amountCents) : 0) -
            (wasPiggy ? piggyImpact(existing.amountCents) : 0);
        if (delta !== 0) {
            await applyPiggyDelta(tx, { userId, deltaCents: delta });
        }
        });
    } catch (error) {
        return {
            ok: false,
            error: actionError(error, "Could not update transaction"),
        };
    }

    revalidatePath("/log");
    revalidatePath("/paycheck");
    revalidatePath("/goals");
  revalidatePath("/projects", "layout");
    return { ok: true };
}

export async function deleteTransaction(input: unknown): Promise<MutateResult> {
    const parsed = deleteTransactionInputSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join("; "),
        };
    }
    const userId = await requireUserId();
    if (!userId) return { ok: false, error: "Not signed in" };

    // Scope the delete to this user — RLS isn't on the client here, we enforce in code.
    try {
    await db.transaction(async (tx) => {
        await lockAllocationOwner(tx, userId);
        const assigned = await tx.select({ amountCents: schema.paycheckAllocations.amountCents })
            .from(schema.paycheckAllocations).where(and(eq(schema.paycheckAllocations.userId, userId), eq(schema.paycheckAllocations.incomeTransactionId, parsed.data.id)));
        const allocationError = incomeEditError({ allocatedCents: assigned.reduce((sum, row) => sum + row.amountCents, 0), existingDate: "", next: null });
        if (allocationError) throw new PublicActionError(allocationError);
        const [existing] = await tx
            .select({
                amountCents: schema.transactions.amountCents,
                envelopeId: schema.transactions.envelopeId,
                fixedExpenseId: schema.transactions.fixedExpenseId,
                goalId: schema.transactions.goalId,
                planFundingCents: schema.transactions.planFundingCents,
            })
            .from(schema.transactions)
            .where(
                and(
                    eq(schema.transactions.id, parsed.data.id),
                    eq(schema.transactions.userId, userId),
                ),
            )
            .limit(1);

        if (!existing) return;
        if (existing.fixedExpenseId) {
            const [recovery] = await tx.select().from(schema.creditCardCommitments)
                .where(and(eq(schema.creditCardCommitments.userId, userId), eq(schema.creditCardCommitments.sourceTransactionId, parsed.data.id)));
            if (recovery?.fundedCents) throw new PublicActionError("This bill has funded recovery. Adjust that funding before deleting it.");
        }

        if (existing.planFundingCents !== null) {
            const [funded] = await tx.select().from(schema.creditCardCommitments).where(and(eq(schema.creditCardCommitments.userId, userId), eq(schema.creditCardCommitments.sourceTransactionId, parsed.data.id)));
            if (funded?.fundedCents) throw new PublicActionError("This purchase has a funded payoff. Reassign that funding before deleting it.");
            await returnPurchaseFunding(tx, userId, parsed.data.id, existing);
        }

        const wasPiggy = await isPiggyEnvelope(tx, {
            userId,
            envelopeId: existing.envelopeId,
        });

        await tx
            .update(schema.creditCardCommitments)
            .set({
                sourceTransactionId: null,
                archivedAt: new Date(),
            })
            .where(
                and(
                    eq(schema.creditCardCommitments.userId, userId),
                    eq(
                        schema.creditCardCommitments.sourceTransactionId,
                        parsed.data.id,
                    ),
                ),
            );

        if (existing.fixedExpenseId) {
            await detachFixedExpensePayment(tx, {
                userId,
                transactionId: parsed.data.id,
                paidDate: format((await getUserToday(userId, tx)), "yyyy-MM-dd"),
                note: "Linked Log entry removed; payment history retained",
            });
        }

        await tx
            .delete(schema.transactions)
            .where(
                and(
                    eq(schema.transactions.id, parsed.data.id),
                    eq(schema.transactions.userId, userId),
                ),
            );

        if (wasPiggy) {
            await tx
                .update(schema.settings)
                .set({
                    piggyBankCents: sql`${schema.settings.piggyBankCents} - ${piggyImpact(existing.amountCents)}`,
                })
                .where(eq(schema.settings.userId, userId));
        }
    });

    } catch (error) {
        return { ok: false, error: actionError(error, "Could not delete transaction") };
    }
    revalidatePath("/log");
    revalidatePath("/paycheck");
    revalidatePath("/goals");
  revalidatePath("/projects", "layout");
    return { ok: true };
}
