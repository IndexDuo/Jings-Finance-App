import { getUserToday } from "@/lib/user-timezone";
import { loadBillFunding } from "@/features/fixed-expenses/funding";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { format } from "date-fns";

import { redirect } from "next/navigation";

import { getVerifiedUser } from "@/lib/supabase/verified-user";
import type {
    EnvelopeInput,
    FixedExpenseInput,
} from "@/features/onboarding/schemas";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

// Pulls the current user's financial data and hands it to the client form.
// The (app)/ layout guarantees an auth'd user + an existing settings row.
export default async function SettingsPage() {
    const user = await getVerifiedUser();
    if (!user) redirect("/login");

    const userId = user.id;
    const billFunding = await loadBillFunding(userId);

    const configuration = await loadFinancialConfiguration(userId);

    const latestDate = [format((await getUserToday(userId)), "yyyy-MM-dd"), ...configuration.versions.map(v => v.effectiveDate)].sort().at(-1)!;
    const { settings: settingsRow, fixedExpenses: fixedRows, envelopes: allEnvelopes } = configuration.at(latestDate);
    const envelopeRows = allEnvelopes.filter(e => !e.archivedAt);

    if (!settingsRow)
        throw new Error("Unreachable — layout guards settings row");

    const fixedExpenses: FixedExpenseInput[] = fixedRows.map((r) => ({
        id: r.id,
        name: r.name,
        amountCents: r.amountCents,
        frequency: r.frequency as FixedExpenseInput["frequency"],
        dueDay: r.dueDay,
        lastPaidDate: r.lastPaidDate,
        nextDueDate: r.nextDueDate,
    }));

    const envelopes: EnvelopeInput[] = envelopeRows
        .filter((r) => !r.isPiggy)
        .map((r) => ({
            id: r.id,
            name: r.name,
            periodAmountCents: r.periodAmountCents,
            period: r.period as EnvelopeInput["period"],
            category: r.category as EnvelopeInput["category"],
            rolloverBehavior:
                r.rolloverBehavior as EnvelopeInput["rolloverBehavior"],
            overflowEnvelopeId: r.overflowEnvelopeId,
            recurrence:
                (r.recurrence as "recurring" | "one-time") ?? "recurring",
        }));

    const todayIso = format((await getUserToday(userId)), "yyyy-MM-dd");
    const pending = configuration.versions.find(v => v.effectiveDate > todayIso);
    const boundary = pending?.scheduleEffectiveDate ?? pending?.effectiveDate;
    const nextBoundary = boundary && boundary > todayIso ? boundary : configuration.period(todayIso).next ?? todayIso;

    return (
        <SettingsForm
            trackedBillIds={billFunding.policies.filter(p => p.activationPayDate).map(p => p.fixedExpenseId)}
            nextBoundary={nextBoundary}
            refillAnchors={Object.fromEntries(envelopeRows.map(row => [row.id, row.accrualStartDate]))}
            scheduledDate={pending?.effectiveDate}
            initial={{
                takeHomeCents: settingsRow.takeHomeCents,
                payFrequency: settingsRow.payFrequency,
                semimonthlyDays: settingsRow.semimonthlyDays,
                timezone: settingsRow.timezone,
                payAnchorDate: settingsRow.payAnchorDate,
                trackingStartDate: settingsRow.trackingStartDate,
                fixedExpenses,
                envelopes,
            }}
        />
    );
}
