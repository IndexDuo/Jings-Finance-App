"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, gt, gte, inArray, isNull } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { currentBudgetEligibility, type BudgetTiming } from "@/features/financial-settings/timing";
import { PublicActionError, actionError } from "@/lib/action-error";

import { db, schema } from "@/lib/db";
import { getAppAuthUser } from "@/lib/supabase/app-user";
import { advanceFixedExpenseDueDate } from "@/features/fixed-expenses/lib/schedule";
import { nextPayDate, previousPayDate, parseLocalIsoDate, todayInUserTz } from "@/lib/dates";

import { onboardingInputSchema } from "./schemas";

export type CompleteOnboardingResult =
    | { ok: true }
    | { ok: false; error: string };

export async function completeOnboarding(
    input: unknown,
    budgetTiming: BudgetTiming = "next",
): Promise<CompleteOnboardingResult> {
    if (budgetTiming !== "current" && budgetTiming !== "next") return { ok: false, error: "Choose when these changes should apply." };
    const parsed = onboardingInputSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join("; "),
        };
    }

    const user = await getAppAuthUser();
    if (!user) return { ok: false, error: "Not signed in" };

    const data = parsed.data;
    const userId = user.id;
    const todayIso = format(todayInUserTz(data.timezone), "yyyy-MM-dd");

    try {
    // Ensure public.users mirror exists (normally written when loading a verified session,
    // but double-check — idempotent).
    await db
        .insert(schema.users)
        .values({ id: userId, email: user.email ?? `demo-${user.id}@example.invalid` })
        .onConflictDoNothing();

    // Settings is keyed by userId — upsert. Other tables are diff-updated by id
    // so existing rows keep their UUIDs across saves. This matters for envelopes
    // because transactions link to envelope_id (ON DELETE SET NULL); a wipe-and-
    // reinsert would orphan every transaction's envelope link.
    await db.transaction(async (tx) => {
        const [existingSettings] = await tx
            .select({
                trackingStartDate: schema.settings.trackingStartDate,
                payAnchorDate: schema.settings.payAnchorDate,
            })
            .from(schema.settings)
            .where(eq(schema.settings.userId, userId))
            .limit(1)
            .for("update");
        const trackingStartDate =
            existingSettings?.trackingStartDate ??
            data.trackingStartDate ??
            todayIso;

        const history = existingSettings ? await loadFinancialConfiguration(userId, tx) : null;
        const immediate = !history || budgetTiming === "current";
        const eligibility = history && immediate
            ? await currentBudgetEligibility(userId, todayIso, history, { ...history.at(todayIso).settings, ...data }, tx)
            : null;
        if (eligibility && !eligibility.canApplyNow) throw new PublicActionError(
            eligibility.reason === "pay-change"
                ? "Pay changes start next paycheck. Save those separately before changing this paycheck's budget."
                : "This paycheck now has recorded activity. Choose Next paycheck to keep that money protected.",
        );
        const billPolicies = await tx.select().from(schema.billFundingPolicies).where(eq(schema.billFundingPolicies.userId, userId));
        const billEvents = await tx.select().from(schema.billFundingEvents).where(eq(schema.billFundingEvents.userId, userId));
        const billSettlements = await tx.select().from(schema.billSettlements).where(eq(schema.billSettlements.userId, userId));
        for (const policy of billPolicies.filter(p => p.activationPayDate)) {
            const incoming = data.fixedExpenses.find(b => b.id === policy.fixedExpenseId);
            const current = history?.at(todayIso).fixedExpenses.find(b => b.id === policy.fixedExpenseId);
            const openReserve = billEvents.some(e => e.fixedExpenseId === policy.fixedExpenseId && e.amountCents > 0 && !billSettlements.some(r => r.fixedExpenseId === e.fixedExpenseId && r.dueDate === e.dueDate));
            if (!incoming && !openReserve) continue;
            if (!incoming || incoming.frequency !== policy.frequency || (incoming.nextDueDate && current?.nextDueDate && incoming.nextDueDate !== current.nextDueDate)) {
                throw new PublicActionError("This bill has tracked funding. Keep its billing schedule and use Log to confirm each bill before removing or rescheduling it. Its amount can still be updated.");
            }
        }
        const pending = history?.versions.find(v => v.effectiveDate > todayIso);
        const pendingBoundary = pending?.scheduleEffectiveDate ?? pending?.effectiveDate;
        const nextExistingPayday = pendingBoundary && pendingBoundary > todayIso ? pendingBoundary : history?.period(todayIso).next ?? todayIso;
        const priorSchedules = [...(pending?.priorSchedules ?? []),
            ...(pending && pendingBoundary && pendingBoundary <= todayIso
                ? [{ effectiveDate: pendingBoundary, payAnchorDate: pending.settings.payAnchorDate, payFrequency: pending.settings.payFrequency, semimonthlyDays: pending.settings.semimonthlyDays }] : [])];
        // Replace only the not-yet-started schedule. Do not pay both the old
        // next payday and the new anchor's first payday during the transition.
        const effectiveDate = immediate
            ? eligibility?.currentPeriod ?? format(previousPayDate(parseLocalIsoDate(data.payAnchorDate), parseLocalIsoDate(todayIso), data), "yyyy-MM-dd")
            : format(nextPayDate(parseLocalIsoDate(data.payAnchorDate), addDays(parseLocalIsoDate(nextExistingPayday), -1), data), "yyyy-MM-dd");
        const sequence = Math.max(0, ...(history?.versions.map(v => v.sequence) ?? []));
        const replacedVersions = history?.versions.filter(v => immediate ? v.effectiveDate >= effectiveDate : v.effectiveDate > todayIso) ?? [];
        const preservedSchedules = immediate ? replacedVersions.flatMap(v => [
            ...(v.priorSchedules ?? []),
            { effectiveDate: v.scheduleEffectiveDate ?? v.effectiveDate, payAnchorDate: v.settings.payAnchorDate,
                payFrequency: v.settings.payFrequency, semimonthlyDays: v.settings.semimonthlyDays },
        ]).filter(v => v.effectiveDate < effectiveDate) : priorSchedules;
        const openingBudgetDate = history?.openingBudgetDate ??
            (immediate && trackingStartDate >= effectiveDate ? trackingStartDate : undefined);
        if (history && history.versions.length === 0) {
            await tx.insert(schema.financialSettingsRevisions).values({ userId,
                effectiveDate: "0001-01-01",
                snapshot: { ...history.fallback, kind: "financial-config-v1", sequence: sequence + 1 },
            });
        }

        await tx.insert(schema.financialSettingsRevisions).values({
            userId,
            effectiveDate: todayIso,
            snapshot: { ...data, trackingStartDate },
        });

        await tx
            .insert(schema.settings)
            .values({
                userId,
                takeHomeCents: data.takeHomeCents,
                payAnchorDate: data.payAnchorDate,
                payFrequency: data.payFrequency,
                semimonthlyDays: data.semimonthlyDays,
                timezone: data.timezone,
                trackingStartDate,
            })
            .onConflictDoUpdate({
                target: schema.settings.userId,
                set: {
                    takeHomeCents: data.takeHomeCents,
                    payAnchorDate: data.payAnchorDate,
                    payFrequency: data.payFrequency,
                semimonthlyDays: data.semimonthlyDays,
                timezone: data.timezone,
                    trackingStartDate,
                },
            });

        // ─── Fixed expenses ─────────────────────────────────────────────────
        const existingFixedRows = await tx
            .select({ id: schema.fixedExpenses.id })
            .from(schema.fixedExpenses)
            .where(eq(schema.fixedExpenses.userId, userId));
        const existingFixedIds = new Set(existingFixedRows.map((r) => r.id));
        const incomingFixedIds = new Set(
            data.fixedExpenses
                .map((e) => e.id)
                .filter((x): x is string => Boolean(x)),
        );

        const fixedToDelete = [...existingFixedIds].filter(
            (id) => !incomingFixedIds.has(id),
        );
        if (fixedToDelete.length > 0) {
            await tx
                .update(schema.fixedExpenses)
                .set({ archivedAt: new Date() })
                .where(
                    and(
                        eq(schema.fixedExpenses.userId, userId),
                        inArray(schema.fixedExpenses.id, fixedToDelete),
                    ),
                );
        }

        for (const e of data.fixedExpenses) {
            const nextDueDate =
                e.nextDueDate ??
                (e.lastPaidDate
                    ? format(
                          advanceFixedExpenseDueDate(
                              parseLocalIsoDate(e.lastPaidDate),
                              e.frequency,
                          ),
                          "yyyy-MM-dd",
                      )
                    : null);
            const dueDay = nextDueDate
                ? Number(nextDueDate.slice(8, 10))
                : e.dueDay;
            if (e.id && existingFixedIds.has(e.id)) {
                await tx
                    .update(schema.fixedExpenses)
                    .set({
                        name: e.name,
                        amountCents: e.amountCents,
                        frequency: e.frequency,
                        dueDay,
                        lastPaidDate: e.lastPaidDate ?? null,
                        nextDueDate,
                        archivedAt: null,
                    })
                    .where(
                        and(
                            eq(schema.fixedExpenses.id, e.id),
                            eq(schema.fixedExpenses.userId, userId),
                        ),
                    );
            } else {
                await tx.insert(schema.fixedExpenses).values({
                    userId,
                    name: e.name,
                    amountCents: e.amountCents,
                    frequency: e.frequency,
                    dueDay,
                    lastPaidDate: e.lastPaidDate ?? null,
                    nextDueDate,
                });
            }
        }

        // ─── Envelopes ──────────────────────────────────────────────────────
        const existingEnvRows = await tx
            .select({
                id: schema.envelopes.id,
                isPiggy: schema.envelopes.isPiggy,
                accrualStartDate: schema.envelopes.accrualStartDate,
                periodAmountCents: schema.envelopes.periodAmountCents,
                period: schema.envelopes.period,
                category: schema.envelopes.category,
                rolloverBehavior: schema.envelopes.rolloverBehavior,
                recurrence: schema.envelopes.recurrence,
                archivedAt: schema.envelopes.archivedAt,
            })
            .from(schema.envelopes)
            .where(eq(schema.envelopes.userId, userId));
        const existingEnvIds = new Set(
            existingEnvRows.filter((r) => !r.isPiggy).map((r) => r.id),
        );
        const existingEnvById = new Map(
            existingEnvRows
                .filter((row) => !row.isPiggy)
                .map((row) => [row.id, row]),
        );
        // Preserve the last known configuration before overwriting editable
        // rows. Older accounts can predate policy history; never use the new
        // amount as their historical baseline. Existing dated history wins.
        const savedPolicies = await tx.select({ envelopeId: schema.envelopePolicyVersions.envelopeId })
            .from(schema.envelopePolicyVersions)
            .where(eq(schema.envelopePolicyVersions.userId, userId));
        const versionedIds = new Set(savedPolicies.map(row => row.envelopeId));
        for (const row of existingEnvRows) {
            if (row.isPiggy || versionedIds.has(row.id)) continue;
            await tx.insert(schema.envelopePolicyVersions).values({
                userId, envelopeId: row.id, effectiveDate: row.accrualStartDate,
                periodAmountCents: row.periodAmountCents, period: row.period,
                category: row.category, rolloverBehavior: row.rolloverBehavior,
                recurrence: row.recurrence,
            });
        }
        if (history && immediate) {
            // Rebudget only the unused current period. Superseded policies are
            // retained in the immutable audit, and all earlier cycles stay intact.
            await tx.delete(schema.envelopePolicyVersions).where(and(
                eq(schema.envelopePolicyVersions.userId, userId),
                gte(schema.envelopePolicyVersions.effectiveDate, effectiveDate),
            ));
        }
        const incomingEnvIds = new Set(
            data.envelopes
                .map((e) => e.id)
                .filter((x): x is string => Boolean(x)),
        );

        const envsToDelete = [...existingEnvIds].filter((id) => {
            const existing = existingEnvById.get(id);
            return !incomingEnvIds.has(id) && (!existing?.archivedAt ||
                (immediate && format(existing.archivedAt, "yyyy-MM-dd") >= effectiveDate));
        });
        if (envsToDelete.length > 0) {
            for (const envelopeId of envsToDelete) {
                const existing = existingEnvById.get(envelopeId)!;
                await tx
                    .insert(schema.envelopePolicyVersions)
                    .values({
                        userId,
                        envelopeId,
                        effectiveDate,
                        periodAmountCents: 0,
                        period: existing.period,
                        category: existing.category,
                        rolloverBehavior: existing.rolloverBehavior,
                        recurrence: "paused",
                    })
                    .onConflictDoUpdate({
                        target: [
                            schema.envelopePolicyVersions.envelopeId,
                            schema.envelopePolicyVersions.effectiveDate,
                        ],
                        set: {
                            periodAmountCents: 0,
                            recurrence: "paused",
                            createdAt: new Date(),
                        },
                    });
            }
            await tx
                .update(schema.envelopes)
                .set({ archivedAt: parseLocalIsoDate(effectiveDate) })
                .where(
                    and(
                        eq(schema.envelopes.userId, userId),
                        inArray(schema.envelopes.id, envsToDelete),
                    ),
                );
        }

        // First pass: insert/update envelopes WITHOUT overflow targets. We need
        // every row to exist before we can resolve overflow ids — a brand-new
        // envelope referenced as another's target won't have an id yet.
        for (const e of data.envelopes) {
            if (e.id && existingEnvIds.has(e.id)) {
                const existing = existingEnvById.get(e.id)!;
                const wasArchived = Boolean(existing.archivedAt);
                const policyChanged =
                    existing.periodAmountCents !== e.periodAmountCents ||
                    existing.period !== e.period ||
                    existing.category !== e.category ||
                    existing.rolloverBehavior !== e.rolloverBehavior ||
                    existing.recurrence !== e.recurrence;
                await tx
                    .update(schema.envelopes)
                    .set({
                        name: e.name,
                        periodAmountCents: e.periodAmountCents,
                        period: e.period,
                        category: e.category,
                        rolloverBehavior: e.rolloverBehavior,
                        recurrence: e.recurrence,
                        archivedAt: null,
                        ...(immediate && existing.accrualStartDate > effectiveDate
                            ? { accrualStartDate: effectiveDate } : {}),
                    })
                    .where(
                        and(
                            eq(schema.envelopes.id, e.id),
                            eq(schema.envelopes.userId, userId),
                        ),
                    );
                if (immediate || policyChanged || wasArchived || existingSettings?.payAnchorDate !== data.payAnchorDate) {
                    const [pendingPolicy] = await tx
                        .select({
                            effectiveDate:
                                schema.envelopePolicyVersions.effectiveDate,
                        })
                        .from(schema.envelopePolicyVersions)
                        .where(
                            and(
                                eq(
                                    schema.envelopePolicyVersions.envelopeId,
                                    e.id,
                                ),
                                gt(
                                    schema.envelopePolicyVersions.effectiveDate,
                                    todayIso,
                                ),
                            ),
                        )
                        .orderBy(
                            asc(schema.envelopePolicyVersions.effectiveDate),
                        )
                        .limit(1);
                    const policyEffectiveDate = effectiveDate;
                    // A rescheduled paycheck can move an unstarted edit. Keep
                    // only the latest pending policy; audit triggers retain it.
                    if (pendingPolicy && pendingPolicy.effectiveDate !== policyEffectiveDate) {
                        await tx.delete(schema.envelopePolicyVersions).where(and(
                            eq(schema.envelopePolicyVersions.envelopeId, e.id),
                            gt(schema.envelopePolicyVersions.effectiveDate, todayIso),
                        ));
                    }
                    await tx
                        .insert(schema.envelopePolicyVersions)
                        .values({
                            userId,
                            envelopeId: e.id,
                            effectiveDate: policyEffectiveDate,
                            periodAmountCents: e.periodAmountCents,
                            period: e.period,
                            category: e.category,
                            rolloverBehavior: e.rolloverBehavior,
                            recurrence: e.recurrence,
                        })
                        .onConflictDoUpdate({
                            target: [
                                schema.envelopePolicyVersions.envelopeId,
                                schema.envelopePolicyVersions.effectiveDate,
                            ],
                            set: {
                                periodAmountCents: e.periodAmountCents,
                                period: e.period,
                                category: e.category,
                                rolloverBehavior: e.rolloverBehavior,
                                recurrence: e.recurrence,
                                createdAt: new Date(),
                            },
                        });
                }
            } else {
                const [inserted] = await tx
                    .insert(schema.envelopes)
                    .values({
                        userId,
                        name: e.name,
                        periodAmountCents: e.periodAmountCents,
                        period: e.period,
                        category: e.category,
                        rolloverBehavior: e.rolloverBehavior,
                        recurrence: e.recurrence,
                        accrualStartDate: effectiveDate,
                    })
                    .returning({ id: schema.envelopes.id });
                await tx.insert(schema.envelopePolicyVersions).values({
                    userId,
                    envelopeId: inserted.id,
                    effectiveDate,
                    periodAmountCents: e.periodAmountCents,
                    period: e.period,
                    category: e.category,
                    rolloverBehavior: e.rolloverBehavior,
                    recurrence: e.recurrence,
                });
            }
        }

        // Second pass: write overflow targets. We can only resolve an overflow id
        // if the source envelope itself has an id (i.e. was previously saved or
        // edited from existing). Self-references and dangling ids are rejected.
        const validEnvIds = new Set(
            (
                await tx
                    .select({ id: schema.envelopes.id })
                    .from(schema.envelopes)
                    .where(
                        and(
                            eq(schema.envelopes.userId, userId),
                            isNull(schema.envelopes.archivedAt),
                        ),
                    )
            ).map((r) => r.id),
        );
        for (const e of data.envelopes) {
            if (!e.id || !validEnvIds.has(e.id)) continue;
            const target =
                e.overflowEnvelopeId &&
                validEnvIds.has(e.overflowEnvelopeId) &&
                e.overflowEnvelopeId !== e.id
                    ? e.overflowEnvelopeId
                    : null;
            await tx
                .update(schema.envelopes)
                .set({ overflowEnvelopeId: target })
                .where(
                    and(
                        eq(schema.envelopes.id, e.id),
                        eq(schema.envelopes.userId, userId),
                    ),
                );
        }

        // ─── Holding buckets ────────────────────────────────────────────────
        const [[savedSettings], savedFixed, savedEnvelopes] = await Promise.all([
            tx.select().from(schema.settings).where(eq(schema.settings.userId, userId)),
            tx.select().from(schema.fixedExpenses).where(eq(schema.fixedExpenses.userId, userId)),
            tx.select().from(schema.envelopes).where(eq(schema.envelopes.userId, userId)),
        ]);
        // Stable database IDs make this an effective configuration rather than
        // an audit-only copy of form fields. Previous versions remain immutable.
        await tx.insert(schema.financialSettingsRevisions).values({ userId, effectiveDate,
            snapshot: { kind: "financial-config-v1", sequence: sequence + 2,
                scheduleEffectiveDate: immediate ? effectiveDate : nextExistingPayday,
                priorSchedules: preservedSchedules,
                openingBudgetDate,
                supersedes: replacedVersions.map(v => v.sequence),
                settings: savedSettings, fixedExpenses: savedFixed, envelopes: savedEnvelopes },
        });
    });


    revalidatePath("/onboarding");
    revalidatePath("/log");
    revalidatePath("/paycheck");
    revalidatePath("/", "layout");
    } catch (error) {
        console.error("completeOnboarding failed");
        return {
            ok: false,
            error: actionError(error, "We couldn't save your settings. Please try again."),
        };
    }

    return { ok: true };
}
