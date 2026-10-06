"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, useTransition } from "react";

import { isValidTimezone, todayInUserTz } from "@/lib/dates";
import { format } from "date-fns";
import type { SchedulePreferences } from "@/features/onboarding/schedule-fields";
import { cn } from "@/lib/utils";

import { completeOnboarding } from "@/features/onboarding/actions";
import {
  EnvelopesSection,
  FixedExpensesSection,
  PaySection,
} from "@/features/onboarding/form-sections";
import {
  type EnvelopeInput,
  type FixedExpenseInput,
  type OnboardingInput,
  onboardingInputSchema,
} from "@/features/onboarding/schemas";

const STEPS = ["Pay", "Bills", "Envelopes"] as const;

const STEP_GUIDANCE = [
  "Enter your paycheck amount and a recent payday.",
  "Add recurring bills you want planned automatically.",
  "Add flexible spending categories if you use them.",
] as const;

type WizardState = SchedulePreferences & {
  takeHomeCents: number | null;
  payAnchorDate: string;
  fixedExpenses: FixedExpenseInput[];
  envelopes: EnvelopeInput[];
};

export function OnboardingWizard({ todayIso }: { todayIso: string }) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>({
    takeHomeCents: null,
    payFrequency: "biweekly",
    semimonthlyDays: [15, 31],
    timezone: "UTC",
    payAnchorDate: todayIso,
    fixedExpenses: [],
    envelopes: [],
    });
  useEffect(() => {
    // Browser preferences are available after hydration.
    const frame = requestAnimationFrame(() => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isValidTimezone(zone)) setState(current => ({ ...current, timezone: zone,
        payAnchorDate: format(todayInUserTz(zone), "yyyy-MM-dd") }));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return (
          state.takeHomeCents !== null && state.takeHomeCents > 0 && !!state.payAnchorDate
        );
      default:
        return true;
    }
  }, [step, state]);

  function next() {
    setStepError(null);
    if (step === STEPS.length - 1) {
      submit();
      return;
    }
    setStep((s) => s + 1);
  }

  function back() {
    setStepError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  function submit() {
    const candidate: OnboardingInput = {
      takeHomeCents: state.takeHomeCents ?? 0,
      payAnchorDate: state.payAnchorDate,
      payFrequency: state.payFrequency,
      semimonthlyDays: state.semimonthlyDays,
      timezone: state.timezone,
      fixedExpenses: state.fixedExpenses,
      envelopes: state.envelopes,
    };
    const result = onboardingInputSchema.safeParse(candidate);
    if (!result.success) {
      setSubmitError(result.error.issues.map((i) => i.message).join("; "));
      return;
    }
    setSubmitError(null);

    startTransition(async () => {
      const res = await completeOnboarding(result.data);
      if (!res.ok) {
        setSubmitError(res.error);
        return;
      }
      window.location.replace("/paycheck");
    });
  }

  return (
    <div className="min-h-svh bg-grouped-bg">
      <div className="mx-auto max-w-xl px-5 pt-10 pb-24">
        <StepIndicator step={step} total={STEPS.length} />
        <h1 className="mt-6 font-ios text-[28px] font-semibold tracking-tight text-label">
          {STEPS[step]}
        </h1>
        <p className="mt-2 text-[14px] text-secondary-label">
          {STEP_GUIDANCE[step]} Steps after Pay are optional. You can skip and add later in Settings.
        </p>

        <div className="mt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {step === 0 && (
                <PaySection
                  preferences={state}
                  onPreferencesChange={patch => setState(current => ({ ...current, ...patch }))}
                  takeHomeCents={state.takeHomeCents}
                  payAnchorDate={state.payAnchorDate}
                  onTakeHomeChange={(takeHomeCents) =>
                    setState((s) => ({ ...s, takeHomeCents }))
                  }
                  onPayAnchorDateChange={(payAnchorDate) =>
                    setState((s) => ({ ...s, payAnchorDate }))
                  }
                />
              )}
              {step === 1 && (
                <FixedExpensesSection
                  paySchedule={state}
                  items={state.fixedExpenses}
                  onChange={(fixedExpenses) => setState((s) => ({ ...s, fixedExpenses }))}
                  onError={setStepError}
                />
              )}
              {step === 2 && (
                <EnvelopesSection
                  paySchedule={state}
                  items={state.envelopes}
                  onChange={(envelopes) => setState((s) => ({ ...s, envelopes }))}
                  onError={setStepError}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {stepError && (
          <p role="alert" className="mt-4 text-[13px] text-system-red">
            {stepError}
          </p>
        )}
        {submitError && (
          <p role="alert" className="mt-4 text-[13px] text-system-red">
            {submitError}
          </p>
        )}

        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            onClick={back}
            disabled={step === 0 || pending}
            className="h-12 flex-1 rounded-button border border-separator bg-system-bg text-[17px] font-medium text-label disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!canGoNext || pending}
            className="h-12 flex-1 rounded-button bg-system-blue text-[17px] font-medium text-white active:scale-[0.99] disabled:opacity-40"
          >
            {pending ? "Saving…" : step === STEPS.length - 1 ? "Finish" : step === 0 ? "Next" : "Next (skip if needed)"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            i <= step ? "bg-system-blue" : "bg-separator",
          )}
        />
      ))}
    </div>
  );
}
