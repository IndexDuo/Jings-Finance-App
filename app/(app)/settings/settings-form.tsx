"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addDays, format } from "date-fns";
import { GroupedCard } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/money-input";
import { completeOnboarding } from "@/features/onboarding/actions";
import {
  EnvelopesSection,
  FixedExpensesSection,
  SettingsField,
  SettingsSave,
  SettingsSheet,
  settingsDate,
  settingsInput,
  settingsMoney,
} from "@/features/onboarding/budget-sections";
import {
  type OnboardingInput,
  onboardingInputSchema,
} from "@/features/onboarding/schemas";
import { ScheduleFields, type SchedulePreferences } from "@/features/onboarding/schedule-fields";
import { PAY_FREQUENCY_LABELS } from "@/lib/pay-schedule";
import { nextPayDate, parseLocalIsoDate } from "@/lib/dates";
import type { BudgetTiming } from "@/features/financial-settings/timing";

export type SettingsFormInitial = OnboardingInput & {
  trackingStartDate: string;
};

function schedulePreferences({ payFrequency, semimonthlyDays, timezone }: SchedulePreferences): SchedulePreferences {
  return { payFrequency, semimonthlyDays, timezone };
}

export function SettingsForm({
  initial,
  nextBoundary,
  scheduledDate,
  refillAnchors,
  trackedBillIds,
  canApplyNow,
  immediateUnavailableReason,
  currentPeriodStart,
}: {
  initial: SettingsFormInitial;
  trackedBillIds?: string[];
  nextBoundary: string;
  scheduledDate?: string;
  refillAnchors?: Record<string, string>;
  canApplyNow: boolean;
  immediateUnavailableReason: "activity" | "pay-change" | null;
  currentPeriodStart: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<"Settings" | "Bills" | "Envelopes">(
    "Settings",
  );
  const [payOpen, setPayOpen] = useState(false);
  const [takeHome, setTakeHome] = useState<number | null>(
    initial.takeHomeCents,
  );
  const [preferences, setPreferences] = useState<SchedulePreferences>(() => schedulePreferences(initial));
  const [anchor, setAnchor] = useState(initial.payAnchorDate);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [budgetTiming, setBudgetTiming] = useState<BudgetTiming>(canApplyNow ? "current" : "next");
  const applyNow = canApplyNow && budgetTiming === "current";
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 5000);
    return () => clearTimeout(timer);
  }, [saved]);
  const [transitionPending, startTransition] = useTransition();
  const [savedSnapshot, setSavedSnapshot] =
    useState<SettingsFormInitial | null>(null);
  // Wait for fresh server IDs after adding an item before allowing another edit.
  const pending = transitionPending || savedSnapshot === initial;
  // Same schedule boundary used by completeOnboarding. Moving the anchor can
  // move the effective payday, so preview the date from the draft too.
  function changesStart(payAnchor: string, schedule: SchedulePreferences = initial) {
    return payAnchor
      ? format(
          nextPayDate(
            parseLocalIsoDate(payAnchor),
            addDays(parseLocalIsoDate(nextBoundary), -1),
            schedule,
          ),
          "yyyy-MM-dd",
        )
      : nextBoundary;
  }
  const effectiveDate = changesStart(initial.payAnchorDate);
  function commit(patch: Partial<OnboardingInput>): Promise<string | null> {
    // Diff-update keeps durable bill and envelope IDs.
    const parsed = onboardingInputSchema.safeParse({
      ...initial,
      ...patch,
    });
    if (!parsed.success)
      return Promise.resolve(
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    setError(null);
    setSaved(false);
    return new Promise((resolve) => {
      startTransition(async () => {
        try {
          const result = await completeOnboarding(parsed.data, view === "Settings" ? "next" : applyNow ? "current" : "next");
          if (!result.ok) {
            resolve(result.error);
            return;
          }
          setSaved(true);
          setSavedSnapshot(initial);
          router.refresh();
          resolve(null);
        } catch {
          resolve("Could not save. Please try again.");
        }
      });
    });
  }
  function closePay() {
    setPayOpen(false);
    setError(null);
  }
  return (
    <main className="mx-auto w-full max-w-xl px-5 pt-6 pb-28">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (view === "Settings") router.back();
          else {
            setView("Settings");
            setError(null);
            setSaved(false);
          }
        }}
        className="mb-3 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-system-blue"
      >
        <ChevronLeft aria-hidden className="h-5 w-5" />
        {view === "Settings" ? "Back" : "Settings"}
      </button>
      {view === "Settings" && (
        <h1 className="mb-6 font-ios text-[28px] font-semibold tracking-tight text-label">
          Settings
        </h1>
      )}
      <fieldset disabled={pending} className="min-w-0 space-y-6">
        {view === "Settings" && (
          <>
            <GroupedCard>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-label">Pay</h2>
                  <button
                    type="button"
                    aria-label="Edit pay"
                    onClick={() => {
                      setTakeHome(initial.takeHomeCents);
                      setAnchor(initial.payAnchorDate);
                      setPreferences(schedulePreferences(initial));
                      setError(null);
                      setSaved(false);
                      setPayOpen(true);
                    }}
                    className="flex h-11 w-11 items-center justify-center text-secondary-label"
                  >
                    <Pencil aria-hidden className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-[28px] font-semibold tabular-nums text-label">
                  {settingsMoney(initial.takeHomeCents)}
                </p>
                <p className="mt-1 text-[15px] text-secondary-label">
                  {PAY_FREQUENCY_LABELS[initial.payFrequency]} · {initial.timezone}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-separator pt-4 text-[15px]">
                  <span className="text-label">Payday reference</span>
                  <span className="text-secondary-label">
                    {settingsDate(initial.payAnchorDate)}
                  </span>
                </div>
              </div>
            </GroupedCard>
            <GroupedCard>
              {(["Bills", "Envelopes"] as const).map((section) => (
                <button
                  type="button"
                  key={section}
                  onClick={() => {
                    setView(section);
                    setError(null);
                    setSaved(false);
                  }}
                  className="flex min-h-16 w-full items-center gap-3 border-b border-separator px-5 py-4 text-left last:border-0"
                >
                  <span className="flex-1 text-[17px] text-label">
                    {section}
                  </span>
                  <span className="text-[15px] tabular-nums text-secondary-label">
                    {section === "Bills"
                      ? initial.fixedExpenses.length
                      : initial.envelopes.length}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="h-4 w-4 text-secondary-label"
                  />
                </button>
              ))}
            </GroupedCard>
            <div>
              <GroupedCard>
                <div className="flex flex-wrap justify-between gap-2 px-5 py-5 text-[15px]">
                  <span className="text-label">Tracking starts</span>
                  <span className="text-secondary-label">
                    {settingsDate(initial.trackingStartDate)}
                  </span>
                </div>
              </GroupedCard>
              <p className="px-5 pt-2 text-[13px] text-secondary-label">
                Set during setup. Earlier logs stay saved.
              </p>
            </div>
          </>
        )}
        {view === "Bills" && (
          <FixedExpensesSection
            paySchedule={initial}
            trackedBillIds={trackedBillIds}
            heading="Bills"
            items={initial.fixedExpenses}
            onError={setError}
            onCommit={(fixedExpenses) => commit({ fixedExpenses })}
            effectiveDate={effectiveDate}
            applyNow={applyNow}
          />
        )}
        {view === "Envelopes" && (
          <EnvelopesSection
            paySchedule={initial}
            heading="Envelopes"
            refillAnchors={refillAnchors}
            currentPeriodStart={currentPeriodStart}
            items={initial.envelopes}
            onError={setError}
            onCommit={(envelopes) => commit({ envelopes })}
            effectiveDate={effectiveDate}
            applyNow={applyNow}
          />
        )}
        {view !== "Settings" && (
          <div className="space-y-2">
            <SettingsField label="Apply budget changes">
              <select aria-label="Apply budget changes" className={settingsInput}
                value={applyNow ? "current" : "next"}
                onChange={event => { setBudgetTiming(event.target.value as BudgetTiming); setSaved(false); }}>
                <option value="current" disabled={!canApplyNow}>This paycheck</option>
                <option value="next">Next paycheck</option>
              </select>
            </SettingsField>
            <p className="text-[13px] text-secondary-label">
              {canApplyNow
                ? applyNow ? "This paycheck is unused. Changes update its budget immediately; earlier paychecks stay unchanged."
                  : `Changes start ${settingsDate(effectiveDate)}. This paycheck stays unchanged.`
                : immediateUnavailableReason === "pay-change"
                  ? "A pay change is scheduled. Budget edits follow that change next paycheck."
                  : "This paycheck has recorded activity. Changes start next paycheck to protect money already used."}
            </p>
          </div>
        )}
        {scheduledDate && view === "Settings" && (
          <p className="text-[13px] text-secondary-label">
            Showing settings scheduled for {settingsDate(scheduledDate)}. This
            paycheck stays unchanged.
          </p>
        )}
      </fieldset>
      {view === "Settings" && <div className="mt-8 flex flex-wrap gap-4 text-system-blue">
        <Link href="/reset-password">Reset password</Link>
        <button type="button" disabled={pending} onClick={async () => {
          const { error } = await createClient().auth.signOut();
          if (error) setError("Could not sign out. Please try again.");
          else window.location.replace("/login");
        }}>Sign out</button>
      </div>}
      {saved && (
        <p role="status" className="mt-4 text-[13px] text-system-green">
          Changes saved.
        </p>
      )}
      {error && !payOpen && (
        <p role="alert" className="mt-4 text-[13px] text-system-red">
          {error}
        </p>
      )}
      {payOpen && (
        <SettingsSheet title="Pay" onClose={closePay} busy={pending}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const failure = await commit({
                takeHomeCents: takeHome ?? 0,
                payAnchorDate: anchor,
                ...preferences,
              });
              if (failure) setError(failure);
              else closePay();
            }}
          >
            <fieldset disabled={pending} className="min-w-0 space-y-6">
              <SettingsField label="Take-home per paycheck">
                <MoneyInput
                  aria-label="Take-home per paycheck"
                  value={takeHome}
                  onChange={setTakeHome}
                />
              </SettingsField>
              <ScheduleFields value={preferences} onChange={patch => setPreferences(current => ({ ...current, ...patch }))}/>
              <div>
                <SettingsField label="Payday reference">
                  <input
                    aria-label="Payday reference"
                    type="date"
                    required
                    value={anchor}
                    onChange={(event) => setAnchor(event.target.value)}
                    className={settingsInput}
                  />
                </SettingsField>
                <p className="mt-2 text-[13px] text-secondary-label">
                  Any payday on your current schedule.
                </p>
              </div>
              <div className="border-t border-separator pt-5">
                <p className="text-[13px] font-medium text-secondary-label">
                  Next payday
                </p>
                <p className="mt-2 text-[17px] text-label">
                  {settingsDate(changesStart(anchor, preferences))}
                </p>
              </div>
              {error && (
                <p role="alert" className="text-[13px] text-system-red">
                  {error}
                </p>
              )}
              <SettingsSave
                busy={pending}
                effectiveDate={changesStart(anchor, preferences)}
              />
            </fieldset>
          </form>
        </SettingsSheet>
      )}
    </main>
  );
}
