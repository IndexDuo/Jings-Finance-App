"use server";

import { PublicActionError, actionError } from "@/lib/action-error";


import { getUserToday } from "@/lib/user-timezone";

import { and, eq, isNull, sql } from "drizzle-orm";
import { format } from "date-fns";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/date-schema";

import { db, schema } from "@/lib/db";
import { getAppAuthUser } from "@/lib/supabase/app-user";
import { todayInUserTz } from "@/lib/dates";
import { loadAllocationSources, lockAllocationOwner } from "./server";
import { splitAllocationSources } from "./lib/sources";

type MutateResult = { ok: true } | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
    const user = await getAppAuthUser();
    return user?.id ?? null;
}

async function ensurePiggyEnvelope(userId: string) {
    const [existing] = await db
        .select({ id: schema.envelopes.id })
        .from(schema.envelopes)
        .where(
            and(
                eq(schema.envelopes.userId, userId),
                eq(schema.envelopes.isPiggy, true),
            ),
        )
        .limit(1);

    if (existing) return existing.id;

    const [inserted] = await db
        .insert(schema.envelopes)
        .values({
            userId,
            name: "Piggy bank",
            periodAmountCents: 0,
            period: "monthly",
            category: "guilt-free",
            rolloverBehavior: "reset",
            recurrence: "one-time",
            isPiggy: true,
        })
        .returning({ id: schema.envelopes.id });

    return inserted.id;
}

const allocationEntrySchema = z
    .object({
        targetKind: z.enum([
            "recovery",
            "goal",
            "envelope",
            "piggy",
            "investment",
        ]),
        goalId: z.string().uuid().nullable().optional(),
        envelopeId: z.string().uuid().nullable().optional(),
        commitmentId: z.string().uuid().nullable().optional(),
        amountCents: z.number().int().nonnegative(),
    })
    .superRefine((value, ctx) => {
        if ((value.targetKind === "goal") !== Boolean(value.goalId)) {
            ctx.addIssue({
                code: "custom",
                path: ["goalId"],
                message: "goalId required only for plan allocations",
            });
        }
        if ((value.targetKind === "envelope") !== Boolean(value.envelopeId)) {
            ctx.addIssue({
                code: "custom",
                path: ["envelopeId"],
                message: "envelopeId required only for envelope allocations",
            });
        }
        if (
            (value.targetKind === "recovery") !==
            Boolean(value.commitmentId)
        ) {
            ctx.addIssue({
                code: "custom",
                path: ["commitmentId"],
                message: "commitmentId required only for recovery allocations",
            });
        }
    });

const recordAllocationsSchema = z.object({
    sources: z.array(z.object({ key: z.string(), amountCents: z.number().int().positive() })).min(1).optional(),
    periodStartIso: calendarDateSchema,
    entries: z.array(allocationEntrySchema).min(1),
});

// The existing allocation form accepts a combined set of sources. Validate the
// displayed snapshot again under a row lock and commit all destinations once.
export async function recordAllocations(input: unknown): Promise<MutateResult> {
    const parsed = recordAllocationsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    const userId = await requireUserId();
    if (!userId) return { ok: false, error: "Not signed in" };
    try {
        await db.transaction(async (tx) => {
            await lockAllocationOwner(tx, userId);
            const todayIso = format((await getUserToday(userId, tx)), "yyyy-MM-dd");
            const available = await loadAllocationSources(userId, todayIso, tx);
            // Old history entry points only request their own leftover period.
            const expected = parsed.data.sources;
            const sources = expected
                ? available.sources.filter((s) => expected.some((e) => e.key === s.key))
                : available.sources.filter((s) => s.kind === "leftover" && s.periodStartIso === parsed.data.periodStartIso);
            if (expected && (sources.length !== expected.length || sources.some((s) => expected.find((e) => e.key === s.key)?.amountCents !== s.amountCents))) {
                throw new PublicActionError("The available money changed. Close this sheet and review the updated amount.");
            }
            if (sources.some(s => s.kind === "leftover") && available.leftoverDeficitCents > 0) {
                throw new PublicActionError("Earlier leftover assignments exceed their source balance. Review those records before assigning more leftover money.");
            }
            const movements = splitAllocationSources(sources, parsed.data.entries);
            const [goals, recoveries] = await Promise.all([
                tx.select().from(schema.goals).where(and(eq(schema.goals.userId, userId), isNull(schema.goals.archivedAt))),
                tx.select().from(schema.creditCardCommitments).where(and(eq(schema.creditCardCommitments.userId, userId), isNull(schema.creditCardCommitments.archivedAt), isNull(schema.creditCardCommitments.completedAt))),
            ]);
            const recoveryById = new Map(recoveries.map((r) => [r.id, r]));
            const envelopeById = new Map(available.envelopes.filter((e) => !e.isPiggy).map((e) => [e.id, e]));
            for (const entry of parsed.data.entries) {
                if (entry.targetKind === "goal" && !goals.some((g) => g.id === entry.goalId)) throw new PublicActionError("Choose an active savings plan");
                if (entry.targetKind === "envelope" && !envelopeById.has(entry.envelopeId!)) throw new PublicActionError("Choose an active envelope");
                if (entry.targetKind === "recovery") {
                    const recovery = recoveryById.get(entry.commitmentId!);
                    if (!recovery || recovery.fundedCents + entry.amountCents > recovery.originalCents) throw new PublicActionError("Recovery allocation is more than the amount left");
                    recovery.fundedCents += entry.amountCents;
                }
            }
            if (movements.some((m) => m.targetKind === "piggy") && !available.envelopes.some((e) => e.isPiggy)) {
                await tx.insert(schema.envelopes).values({ userId, name: "Piggy bank", periodAmountCents: 0, period: "monthly", category: "guilt-free", rolloverBehavior: "reset", recurrence: "one-time", isPiggy: true });
            }
            for (const movement of movements) {
                const { source, amountCents, targetKind, goalId, envelopeId, commitmentId } = movement;
                const note = (source.kind === "plan-release" || source.kind === "bill-release") ? source.label : source.kind === "income" ? `Extra income: ${source.label} (${source.date})` : `Unused envelope budget from ${source.periodStartIso}`;
                await tx.insert(schema.paycheckAllocations).values({
                    userId, periodStartDate: source.periodStartIso,
                    incomeTransactionId: source.incomeTransactionId, assignedPayDate: available.currentPayIso,
                    releasedPlanId: source.releasedPlanId ?? null,
                    releasedBillId: source.releasedBillId ?? null,
                    targetKind, goalId: goalId ?? null, envelopeId: envelopeId ?? null,
                    commitmentId: commitmentId ?? null, amountCents,
                });
                if (targetKind === "goal" && goalId) {
                    await tx.insert(schema.goalFundingEvents).values({ userId, goalId, kind: "paycheck-allocation", amountCents, note });
                    await tx.update(schema.goals).set({ currentCents: sql`${schema.goals.currentCents} + ${amountCents}` }).where(and(eq(schema.goals.userId, userId), eq(schema.goals.id, goalId)));
                } else if (targetKind === "recovery" && commitmentId) {
                    await tx.insert(schema.creditCardFundingEvents).values({ userId, commitmentId, kind: "leftover-allocation", amountCents, note });
                    await tx.update(schema.creditCardCommitments).set({ fundedCents: sql`${schema.creditCardCommitments.fundedCents} + ${amountCents}` }).where(and(eq(schema.creditCardCommitments.userId, userId), eq(schema.creditCardCommitments.id, commitmentId)));
                } else if (targetKind === "envelope" && envelopeId) {
                    await tx.insert(schema.envelopeFundingEvents).values({ userId, envelopeId, envelopeName: envelopeById.get(envelopeId)!.name,
                        sourcePeriodStartDate: source.periodStartIso,
                        // Income received mid-cycle must be usable today, not
                        // reset away by a weekly allowance accrual yesterday.
                        targetPeriodStartDate: todayIso, amountCents, note });
                } else if (targetKind === "piggy") {
                    await tx.update(schema.settings).set({ piggyBankCents: sql`${schema.settings.piggyBankCents} + ${amountCents}` }).where(eq(schema.settings.userId, userId));
                }
            }
        });
    } catch (error) {
        return { ok: false, error: actionError(error, "Could not save allocations") };
    }
    for (const path of ["/paycheck", "/log", "/goals", "/projects"]) revalidatePath(path, "layout");
    return { ok: true };
}
const updateAllocationsSchema = z.object({
    periodStartIso: calendarDateSchema,
    entries: z.array(allocationEntrySchema).min(1),
});

export async function updateAllocations(input: unknown): Promise<MutateResult> {
    const parsed = updateAllocationsSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join("; "),
        };
    }
    const userId = await requireUserId();
    if (!userId) return { ok: false, error: "Not signed in" };

    const { periodStartIso, entries } = parsed.data;
    const [settings] = await db.select({ timezone: schema.settings.timezone }).from(schema.settings).where(eq(schema.settings.userId, userId));

    const existingRows = await db
        .select({
            id: schema.paycheckAllocations.id,
            targetKind: schema.paycheckAllocations.targetKind,
            goalId: schema.paycheckAllocations.goalId,
            envelopeId: schema.paycheckAllocations.envelopeId,
            commitmentId: schema.paycheckAllocations.commitmentId,
            amountCents: schema.paycheckAllocations.amountCents,
            createdAt: schema.paycheckAllocations.createdAt,
            assignedPayDate: schema.paycheckAllocations.assignedPayDate,
        })
        .from(schema.paycheckAllocations)
        .where(
            and(
                eq(schema.paycheckAllocations.userId, userId),
                isNull(schema.paycheckAllocations.incomeTransactionId),
                isNull(schema.paycheckAllocations.releasedPlanId),
                isNull(schema.paycheckAllocations.releasedBillId),
                eq(schema.paycheckAllocations.periodStartDate, periodStartIso),
            ),
        );

    if (existingRows.length === 0) {
        return { ok: false, error: "No existing allocation to edit" };
    }

    const totalAllocated = existingRows.reduce((s, r) => s + r.amountCents, 0);
    const piggyAllocated = existingRows
        .filter((r) => r.targetKind === "piggy")
        .reduce((s, r) => s + r.amountCents, 0);

    const [piggyEnvelope] = await db
        .select({ id: schema.envelopes.id })
        .from(schema.envelopes)
        .where(
            and(
                eq(schema.envelopes.userId, userId),
                eq(schema.envelopes.isPiggy, true),
            ),
        )
        .limit(1);

    let piggySpent = 0;
    if (piggyEnvelope) {
        const allocationDate = existingRows
            .map((r) => r.createdAt)
            .sort((a, b) => a.getTime() - b.getTime())[0];
        const allocationIso = format(todayInUserTz(settings?.timezone ?? "UTC", allocationDate), "yyyy-MM-dd");
        const piggySpendRows = await db
            .select({ amountCents: schema.transactions.amountCents })
            .from(schema.transactions)
            .where(
                and(
                    eq(schema.transactions.userId, userId),
                    eq(schema.transactions.envelopeId, piggyEnvelope.id),
                    sql`${schema.transactions.date} >= ${allocationIso}`,
                ),
            );
        piggySpent = piggySpendRows.reduce(
            (s, r) => s + Math.abs(r.amountCents),
            0,
        );
    }

    const piggyUsed = Math.min(piggyAllocated, piggySpent);
    const reallocatable = Math.max(0, totalAllocated - piggyUsed);

    const nextTotal = entries.reduce((s, e) => s + e.amountCents, 0);
    if (nextTotal !== reallocatable) {
        return {
            ok: false,
            error: "Allocation total must match remaining leftover",
        };
    }
    // Already-spent Piggy money is historical, not reallocatable. Keep that
    // protected slice in the replacement snapshot while the UI edits only the
    // amount that is still available to move.
    const effectiveEntries = entries.map((entry) => ({ ...entry }));
    if (piggyUsed > 0) {
        const existingPiggyEntry = effectiveEntries.find(
            (entry) => entry.targetKind === "piggy",
        );
        if (existingPiggyEntry) {
            existingPiggyEntry.amountCents += piggyUsed;
        } else {
            effectiveEntries.push({
                targetKind: "piggy",
                goalId: null,
                envelopeId: null,
                commitmentId: null,
                amountCents: piggyUsed,
            });
        }
    }

    const goalIds = Array.from(
        new Set(
            effectiveEntries
                .map((e) => e.goalId)
                .filter((id): id is string => typeof id === "string"),
        ),
    );
    if (goalIds.length > 0) {
        const owned = await db
            .select({ id: schema.goals.id })
            .from(schema.goals)
            .where(eq(schema.goals.userId, userId));
        const ownedSet = new Set(owned.map((g) => g.id));
        for (const id of goalIds) {
            if (!ownedSet.has(id)) return { ok: false, error: "Unknown goal" };
        }
    }

    const updateEnvelopeIds = Array.from(
        new Set(
            effectiveEntries
                .map((entry) => entry.envelopeId)
                .filter((id): id is string => typeof id === "string"),
        ),
    );
    const updateEnvelopeRows = await db
        .select({
            id: schema.envelopes.id,
            name: schema.envelopes.name,
            isPiggy: schema.envelopes.isPiggy,
        })
        .from(schema.envelopes)
        .where(eq(schema.envelopes.userId, userId));
    const updateEnvelopeNameById = new Map(
        updateEnvelopeRows
            .filter((row) => !row.isPiggy)
            .map((row) => [row.id, row.name]),
    );
    for (const id of updateEnvelopeIds) {
        if (!updateEnvelopeNameById.has(id)) {
            return { ok: false, error: "Unknown envelope" };
        }
    }
    const updateRecoveryIds = Array.from(
        new Set(
            effectiveEntries
                .map((entry) => entry.commitmentId)
                .filter((id): id is string => typeof id === "string"),
        ),
    );
    const updateRecoveryRows = await db
        .select({
            id: schema.creditCardCommitments.id,
            originalCents: schema.creditCardCommitments.originalCents,
            fundedCents: schema.creditCardCommitments.fundedCents,
        })
        .from(schema.creditCardCommitments)
        .where(eq(schema.creditCardCommitments.userId, userId));
    const updateRecoveryById = new Map(
        updateRecoveryRows.map((row) => [row.id, row]),
    );
    for (const id of updateRecoveryIds) {
        if (!updateRecoveryById.has(id)) {
            return { ok: false, error: "Unknown recovery" };
        }
    }

    const oldByGoal = new Map<string, number>();
    const oldByEnvelope = new Map<string, number>();
    const oldByRecovery = new Map<string, number>();
    let oldPiggy = 0;
    for (const r of existingRows) {
        if (r.targetKind === "recovery" && r.commitmentId) {
            oldByRecovery.set(
                r.commitmentId,
                (oldByRecovery.get(r.commitmentId) ?? 0) + r.amountCents,
            );
        } else if (r.targetKind === "goal" && r.goalId) {
            oldByGoal.set(
                r.goalId,
                (oldByGoal.get(r.goalId) ?? 0) + r.amountCents,
            );
        } else if (r.targetKind === "envelope" && r.envelopeId) {
            oldByEnvelope.set(
                r.envelopeId,
                (oldByEnvelope.get(r.envelopeId) ?? 0) + r.amountCents,
            );
        } else if (r.targetKind === "piggy") {
            oldPiggy += r.amountCents;
        }
    }

    const nextByGoal = new Map<string, number>();
    const nextByEnvelope = new Map<string, number>();
    const nextByRecovery = new Map<string, number>();
    let nextPiggy = 0;
    for (const e of effectiveEntries) {
        if (e.targetKind === "recovery" && e.commitmentId) {
            nextByRecovery.set(
                e.commitmentId,
                (nextByRecovery.get(e.commitmentId) ?? 0) + e.amountCents,
            );
        } else if (e.targetKind === "goal" && e.goalId) {
            nextByGoal.set(
                e.goalId,
                (nextByGoal.get(e.goalId) ?? 0) + e.amountCents,
            );
        } else if (e.targetKind === "envelope" && e.envelopeId) {
            nextByEnvelope.set(
                e.envelopeId,
                (nextByEnvelope.get(e.envelopeId) ?? 0) + e.amountCents,
            );
        } else if (e.targetKind === "piggy") {
            nextPiggy += e.amountCents;
        }
    }

    const goalDeltas = new Map<string, number>();
    for (const [id, amount] of oldByGoal.entries()) {
        goalDeltas.set(id, (goalDeltas.get(id) ?? 0) - amount);
    }
    for (const [id, amount] of nextByGoal.entries()) {
        goalDeltas.set(id, (goalDeltas.get(id) ?? 0) + amount);
    }
    const envelopeDeltas = new Map<string, number>();
    for (const [id, amount] of oldByEnvelope.entries()) {
        envelopeDeltas.set(id, (envelopeDeltas.get(id) ?? 0) - amount);
    }
    const recoveryDeltas = new Map<string, number>();
    for (const [id, amount] of oldByRecovery.entries()) {
        recoveryDeltas.set(id, (recoveryDeltas.get(id) ?? 0) - amount);
    }
    for (const [id, amount] of nextByRecovery.entries()) {
        recoveryDeltas.set(id, (recoveryDeltas.get(id) ?? 0) + amount);
    }
    for (const [id, delta] of recoveryDeltas.entries()) {
        const recovery = updateRecoveryById.get(id);
        if (!recovery) return { ok: false, error: "Unknown recovery" };
        const nextFunded = recovery.fundedCents + delta;
        if (nextFunded < 0 || nextFunded > recovery.originalCents) {
            return {
                ok: false,
                error: "Recovery allocation is outside the amount remaining",
            };
        }
    }
    for (const [id, amount] of nextByEnvelope.entries()) {
        envelopeDeltas.set(id, (envelopeDeltas.get(id) ?? 0) + amount);
    }
    const piggyDelta = nextPiggy - oldPiggy;

    const [settingsRow] = await db
        .select({ piggyBankCents: schema.settings.piggyBankCents })
        .from(schema.settings)
        .where(eq(schema.settings.userId, userId))
        .limit(1);
    const nextPiggyBalance = (settingsRow?.piggyBankCents ?? 0) + piggyDelta;
    if (nextPiggyBalance < 0) {
        return { ok: false, error: "Piggy bank balance would go negative" };
    }

    const goalRows = await db
        .select({
            id: schema.goals.id,
            currentCents: schema.goals.currentCents,
        })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId));
    const goalCurrent = new Map(goalRows.map((g) => [g.id, g.currentCents]));
    for (const [id, delta] of goalDeltas.entries()) {
        const current = goalCurrent.get(id) ?? 0;
        if (current + delta < 0) {
            return { ok: false, error: "Goal balance would go negative" };
        }
    }

    const hasPiggy = nextPiggy > 0;
    if (hasPiggy) {
        await ensurePiggyEnvelope(userId);
    }
    const targetPeriodStartIso = (await loadFinancialConfiguration(userId)).period(periodStartIso).next;

    await db.transaction(async (tx) => {
        await tx
            .delete(schema.paycheckAllocations)
            .where(
                and(
                    eq(schema.paycheckAllocations.userId, userId),
                isNull(schema.paycheckAllocations.incomeTransactionId),
                isNull(schema.paycheckAllocations.releasedPlanId),
                isNull(schema.paycheckAllocations.releasedBillId),
                    eq(
                        schema.paycheckAllocations.periodStartDate,
                        periodStartIso,
                    ),
                ),
            );

        await tx.insert(schema.paycheckAllocations).values(
            effectiveEntries
                .filter((e) => e.amountCents > 0)
                .map((e) => ({
                    userId,
                    periodStartDate: periodStartIso,
                    assignedPayDate: existingRows[0].assignedPayDate,
                    targetKind: e.targetKind,
                    goalId: e.goalId ?? null,
                    envelopeId: e.envelopeId ?? null,
                    commitmentId: e.commitmentId ?? null,
                    amountCents: e.amountCents,
                })),
        );

        for (const [goalId, delta] of goalDeltas.entries()) {
            if (delta === 0) continue;
            await tx.insert(schema.goalFundingEvents).values({
                userId,
                goalId,
                kind: "paycheck-allocation",
                amountCents: delta,
                note: `Allocation correction for ${periodStartIso}`,
            });
            await tx
                .update(schema.goals)
                .set({
                    currentCents: sql`${schema.goals.currentCents} + ${delta}`,
                })
                .where(
                    and(
                        eq(schema.goals.id, goalId),
                        eq(schema.goals.userId, userId),
                    ),
                );
        }

        for (const [commitmentId, delta] of recoveryDeltas.entries()) {
            if (delta === 0) continue;
            const recovery = updateRecoveryById.get(commitmentId);
            if (!recovery) continue;
            const nextFundedCents = recovery.fundedCents + delta;
            await tx.insert(schema.creditCardFundingEvents).values({
                userId,
                commitmentId,
                kind: "leftover-allocation-correction",
                amountCents: delta,
                note: `Allocation correction for ${periodStartIso}`,
            });
            await tx
                .update(schema.creditCardCommitments)
                .set({
                    fundedCents: nextFundedCents,
                })
                .where(
                    and(
                        eq(schema.creditCardCommitments.id, commitmentId),
                        eq(schema.creditCardCommitments.userId, userId),
                    ),
                );
        }

        for (const [envelopeId, delta] of envelopeDeltas.entries()) {
            if (delta === 0) continue;
            await tx.insert(schema.envelopeFundingEvents).values({
                userId,
                envelopeId,
                envelopeName:
                    updateEnvelopeNameById.get(envelopeId) ?? "Envelope",
                sourcePeriodStartDate: periodStartIso,
                targetPeriodStartDate: targetPeriodStartIso,
                amountCents: delta,
                note: `Allocation correction for ${periodStartIso}`,
            });
        }

        if (piggyDelta !== 0) {
            await tx
                .update(schema.settings)
                .set({
                    piggyBankCents: sql`${schema.settings.piggyBankCents} + ${piggyDelta}`,
                })
                .where(eq(schema.settings.userId, userId));
        }
    });

    revalidatePath("/paycheck");
    revalidatePath("/goals");
  revalidatePath("/projects", "layout");
    return { ok: true };
}

const transferPiggyToGoalSchema = z.object({
    goalId: z.string().uuid(),
    amountCents: z.number().int().positive("Enter an amount greater than $0"),
});

// Piggy money is already part of the user's balance. Moving it to a plan is a
// reallocation, not new income or another paycheck expense.
export async function transferPiggyToGoal(
    input: unknown,
): Promise<MutateResult> {
    const parsed = transferPiggyToGoalSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues.map((issue) => issue.message).join("; "),
        };
    }
    const userId = await requireUserId();
    if (!userId) return { ok: false, error: "Not signed in" };

    const { goalId, amountCents } = parsed.data;
    const [goal] = await db
        .select({ id: schema.goals.id })
        .from(schema.goals)
        .where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, userId)))
        .limit(1);
    if (!goal) return { ok: false, error: "Unknown plan" };

    try {
        await db.transaction(async (tx) => {
            const [settings] = await tx
                .select({ piggyBankCents: schema.settings.piggyBankCents })
                .from(schema.settings)
                .where(eq(schema.settings.userId, userId))
                .limit(1);
            if (!settings || settings.piggyBankCents < amountCents) {
                throw new PublicActionError("That amount is no longer available in your piggy bank");
            }

            await tx
                .update(schema.settings)
                .set({
                    piggyBankCents: sql`${schema.settings.piggyBankCents} - ${amountCents}`,
                })
                .where(eq(schema.settings.userId, userId));
            await tx.insert(schema.goalFundingEvents).values({
                userId,
                goalId,
                kind: "piggy-transfer",
                amountCents,
                note: "Moved from Piggy bank reserve",
            });
            await tx
                .update(schema.goals)
                .set({
                    currentCents: sql`${schema.goals.currentCents} + ${amountCents}`,
                })
                .where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, userId)));
        });
    } catch (error) {
        return {
            ok: false,
            error:
                actionError(error, "Could not move the reserve"),
        };
    }

    revalidatePath("/goals");
  revalidatePath("/projects", "layout");
    revalidatePath("/paycheck");
    return { ok: true };
}
