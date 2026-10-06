"use client";

import { addDays } from "date-fns";
import { useMemo } from "react";

import { GroupedCard } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/money-input";
import { parseLocalIsoDate, projectPaychecks, todayInUserTz } from "@/lib/dates";

import { ScheduleFields, type SchedulePreferences } from "./schedule-fields";

// Shared building blocks for the onboarding wizard and the /settings page.
// Each section is a controlled piece (value + onChange). No persistence logic
// lives here — that's the caller's job.

// ─── Shared primitives ─────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[13px] font-medium text-secondary-label">{children}</label>
  );
}

// ─── Pay ────────────────────────────────────────────────────────────────────

export interface PaySectionProps {
  preferences: SchedulePreferences;
  onPreferencesChange: (patch: Partial<SchedulePreferences>) => void;
  takeHomeCents: number | null;
  payAnchorDate: string;
  onTakeHomeChange: (cents: number | null) => void;
  onPayAnchorDateChange: (date: string) => void;
  /** Hides the projected-paychecks preview card if true. */
  hidePreview?: boolean;
}

export function PaySection({
  preferences,
  onPreferencesChange,
  takeHomeCents,
  payAnchorDate,
  onTakeHomeChange,
  onPayAnchorDateChange,
  hidePreview = false,
}: PaySectionProps) {
  const preview = useMemo(() => {
    if (hidePreview || !payAnchorDate) return [];
    try {
      // Local-zone parse — bare YYYY-MM-DD via parseISO would land on UTC
      // midnight and shift the projected paychecks by a day.
      const anchor = parseLocalIsoDate(payAnchorDate);
      const from = todayInUserTz(preferences.timezone);
      const to = addDays(from, 90);
      return projectPaychecks(anchor, from, to, preferences).slice(0, 6);
    } catch {
      return [];
    }
  }, [payAnchorDate, hidePreview, preferences]);

  return (
    <div className="space-y-4">
      <GroupedCard header="Schedule and timezone"><div className="px-5 py-3">
        <ScheduleFields value={preferences} onChange={onPreferencesChange}/>
      </div></GroupedCard>
      <GroupedCard header="Take-home per paycheck">
        <div className="px-5 py-3">
          <Label>Amount</Label>
          <MoneyInput aria-label="Take-home per paycheck" value={takeHomeCents} onChange={onTakeHomeChange} placeholder="1500.00" />
          <p className="mt-2 text-[13px] text-secondary-label">
            Enter the amount that lands in your account per paycheck.
          </p>
        </div>
      </GroupedCard>

      <GroupedCard header="Pay anchor date">
        <div className="px-5 py-3">
          <Label>Most recent payday</Label>
          <input
            aria-label="Most recent payday"
            type="date"
            value={payAnchorDate}
            onChange={(e) => onPayAnchorDateChange(e.target.value)}
            className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none"
          />
          <p className="mt-2 text-[13px] text-secondary-label">
            Use a recent payday so future paycheck dates stay accurate.
          </p>
        </div>
      </GroupedCard>

      {preview.length > 0 && (
        <GroupedCard header="Next paychecks">
          <ul>
            {preview.map((d) => (
              <li
                key={d.toISOString()}
                className="flex items-center justify-between border-b border-separator px-5 py-3 last:border-b-0"
              >
                <span className="text-[17px] text-label">
                  {d.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="text-[15px] text-secondary-label">
                  {d.toLocaleDateString(undefined, { year: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        </GroupedCard>
      )}
    </div>
  );
}


export { FixedExpensesSection, EnvelopesSection } from "./budget-sections";
