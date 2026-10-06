import { scheduleKey, type PaySchedule } from "@/lib/pay-schedule";
import { addDays, format } from "date-fns";
import { parseLocalIsoDate, projectPaychecks } from "@/lib/dates";
import type { schema } from "@/lib/db";

export type Settings = typeof schema.settings.$inferSelect;
export type FixedExpense = typeof schema.fixedExpenses.$inferSelect;
export type Envelope = typeof schema.envelopes.$inferSelect;
export interface Configuration {
  settings: Omit<Settings, "piggyBankCents">;
  fixedExpenses: FixedExpense[];
  envelopes: Envelope[];
}
export interface ConfigurationVersion extends Configuration {
  kind: "financial-config-v1";
  sequence: number;
  effectiveDate: string;
  supersedes?: number[];
  scheduleEffectiveDate?: string;
  priorSchedules?: ({ effectiveDate: string; payAnchorDate: string } & PaySchedule)[];
  /** Explicit opt-in: older accounts must never acquire retroactive opening grants. */
  openingBudgetDate?: string;
}

/** Legacy audit-only submissions have unresolved IDs and are not configurations. */
export function configurationVersions(rows: readonly { effectiveDate: string; snapshot: unknown }[]): ConfigurationVersion[] {
  const versions = rows.flatMap(row => {
    const value = row.snapshot as Partial<ConfigurationVersion> | null;
    if (value?.kind !== "financial-config-v1") return [];
    if (!value.settings || !Array.isArray(value.fixedExpenses) || !Array.isArray(value.envelopes) || !Number.isSafeInteger(value.sequence)) {
      throw new Error("Invalid financial configuration history");
    }
    return [{ ...value, effectiveDate: row.effectiveDate } as ConfigurationVersion];
  });
  const superseded = new Set(versions.flatMap(v => v.supersedes ?? []));
  return versions.filter(v => !superseded.has(v.sequence)).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence);
}

export function configurationAt(versions: readonly ConfigurationVersion[], fallback: Configuration, date: string): Configuration {
  return versions.filter(v => v.effectiveDate <= date).at(-1) ?? fallback;
}

/** Merge schedule segments; a new anchor never generates replacement past paydays. */
export function configurationPaydays(versions: readonly ConfigurationVersion[], fallback: Configuration, from: string, to: string): string[] {
  const candidates = new Set<string>();
  const schedules = versions.flatMap(v => [
    ...(v.priorSchedules ?? []).map(p => ({ ...p, sequence: v.sequence })),
    { effectiveDate: v.scheduleEffectiveDate ?? v.effectiveDate,
      payAnchorDate: v.settings.payAnchorDate, payFrequency: v.settings.payFrequency,
      semimonthlyDays: v.settings.semimonthlyDays, sequence: v.sequence },
  ]).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence);
  const initial = schedules[0] ?? fallback.settings;
  const key = (s: PaySchedule & { payAnchorDate: string }) => `${s.payAnchorDate}:${scheduleKey(s)}`;
  const configurations = new Map([initial, ...schedules].map(s => [key(s), s]));
  for (const [identity, config] of configurations) {
    for (const day of projectPaychecks(parseLocalIsoDate(config.payAnchorDate), parseLocalIsoDate(from), parseLocalIsoDate(to), config)) {
      const date = format(day, "yyyy-MM-dd");
      const active = schedules.filter(v => v.effectiveDate <= date).at(-1) ?? initial;
      if (key(active) === identity) candidates.add(date);
    }
  }
  return [...candidates].sort();
}

export function configurationPayPeriod(versions: readonly ConfigurationVersion[], fallback: Configuration, date: string) {
  const days = configurationPaydays(versions, fallback,
    format(addDays(parseLocalIsoDate(date), -60), "yyyy-MM-dd"),
    format(addDays(parseLocalIsoDate(date), 60), "yyyy-MM-dd"));
  const current = days.filter(d => d <= date).at(-1);
  const next = days.find(d => d > date);
  if (!current || !next) throw new Error("Cannot resolve paycheck period");
  return { current, next };
}
