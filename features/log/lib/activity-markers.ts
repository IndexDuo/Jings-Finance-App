import type { PaySchedule } from "@/lib/pay-schedule";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";

import {
  proratePerPaycheck,
  annualize,
  type Period,
} from "@/features/paycheck/lib/proration";
import { parseLocalIsoDate, previousPayDate } from "@/lib/dates";

export type ActivityMarker = "green" | "red" | "gray";

export interface MarkerEnvelope {
  id: string;
  category: "variable" | "guilt-free";
  periodAmountCents: number;
  period: Period;
  rolloverBehavior: "reset" | "accumulate";
  isPiggy?: boolean;
}

export interface MarkerTransaction {
  date: string;
  amountCents: number;
  category: "income" | "fixed" | "variable" | "guilt-free" | "note";
  envelopeId: string | null;
}

export function computeNoteDates(
  transactions: readonly MarkerTransaction[],
): Set<string> {
  return new Set(
    transactions
      .filter((transaction) => transaction.category === "note")
      .map((transaction) => transaction.date),
  );
}

export function computeActivityMarkers({
  envelopes,
  transactions,
  payAnchorIso,
  datedConfiguration,
}: {
  envelopes: readonly MarkerEnvelope[];
  transactions: readonly MarkerTransaction[];
  payAnchorIso: string;
  datedConfiguration?: Record<string, { envelopes: readonly MarkerEnvelope[]; payAnchorIso: string; periodStartIso: string; paySchedule?: PaySchedule }>;
}): Map<string, ActivityMarker> {
  const markers = new Map<string, ActivityMarker>();
  for (const tx of transactions) {
    const existing = markers.get(tx.date);
    if (tx.category === "note") {
      if (!existing) markers.set(tx.date, "gray");
    } else if (existing !== "red") {
      markers.set(tx.date, "green");
    }
  }

  const envelopeById = new Map(envelopes.map((e) => [e.id, e]));
  const spendByEnvelope = new Map<string, Map<string, number>>();

  for (const tx of transactions) {
    if (tx.category !== "variable" && tx.category !== "guilt-free") continue;
    if (!tx.envelopeId) continue;
    const envelope = datedConfiguration?.[tx.date]?.envelopes.find(e => e.id === tx.envelopeId) ?? envelopeById.get(tx.envelopeId);
    if (!envelope || envelope.isPiggy) continue;
    const byDate = spendByEnvelope.get(envelope.id) ?? new Map<string, number>();
    byDate.set(tx.date, (byDate.get(tx.date) ?? 0) + Math.abs(tx.amountCents));
    spendByEnvelope.set(envelope.id, byDate);
  }

  const payAnchor = parseLocalIsoDate(payAnchorIso);
  for (const [envelopeId, spendByDate] of spendByEnvelope) {
    const windows = new Map<string, { budgetCents: number; dates: Map<string, number> }>();

    for (const [dateIso, spendCents] of spendByDate) {
      const dated = datedConfiguration?.[dateIso];
      const envelope = dated?.envelopes.find(e => e.id === envelopeId) ?? envelopeById.get(envelopeId);
      if (!envelope) continue;
      const window = budgetWindow(envelope, dateIso, dated ? parseLocalIsoDate(dated.payAnchorIso) : payAnchor, dated?.paySchedule);
      if (dated && envelope.category !== "guilt-free" && envelope.rolloverBehavior === "reset") {
        window.key = `paycheck:${dated.periodStartIso}`;
      }
      const existing = windows.get(window.key) ?? {
        budgetCents: window.budgetCents,
        dates: new Map<string, number>(),
      };
      existing.dates.set(dateIso, (existing.dates.get(dateIso) ?? 0) + spendCents);
      windows.set(window.key, existing);
    }

    for (const window of windows.values()) {
      let running = 0;
      for (const dateIso of Array.from(window.dates.keys()).sort()) {
        running += window.dates.get(dateIso) ?? 0;
        if (running > window.budgetCents) markers.set(dateIso, "red");
      }
    }
  }

  return markers;
}

function budgetWindow(envelope: MarkerEnvelope, dateIso: string, payAnchor: Date, schedule?: PaySchedule) {
  const date = parseLocalIsoDate(dateIso);
  if (envelope.category === "guilt-free") {
    const start = startOfWeek(date, { weekStartsOn: 1 });
    const end = endOfWeek(date, { weekStartsOn: 1 });
    return {
      key: `week:${format(start, "yyyy-MM-dd")}`,
      startIso: format(start, "yyyy-MM-dd"),
      endIso: format(end, "yyyy-MM-dd"),
      budgetCents: weeklyFromPeriod(envelope.periodAmountCents, envelope.period),
    };
  }

  if (envelope.rolloverBehavior === "accumulate") {
    const start = startOfMonth(date);
    const end = endOfMonth(date);
    return {
      key: `month:${format(start, "yyyy-MM-dd")}`,
      startIso: format(start, "yyyy-MM-dd"),
      endIso: format(end, "yyyy-MM-dd"),
      budgetCents: monthlyFromPeriod(envelope.periodAmountCents, envelope.period),
    };
  }

  const start = previousPayDate(payAnchor, date, schedule);
  return {
    key: `paycheck:${format(start, "yyyy-MM-dd")}`,
    startIso: format(start, "yyyy-MM-dd"),
    endIso: "",
    budgetCents: proratePerPaycheck(envelope.periodAmountCents, envelope.period, schedule),
  };
}

function weeklyFromPeriod(cents: number, period: Period): number {
  return Math.round(annualize(cents, period) / 52);
}

function monthlyFromPeriod(cents: number, period: Period): number {
  return Math.round(annualize(cents, period) / 12);
}
