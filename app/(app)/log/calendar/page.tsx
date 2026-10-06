import { getUserToday } from "@/lib/user-timezone";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { and, between, eq } from "drizzle-orm";
import {
  addDays,
  endOfMonth,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";
import { parseLocalIsoDate } from "@/lib/dates";
import { getVerifiedUser } from "@/lib/supabase/verified-user";

import { CalendarView, type CalendarDay } from "./calendar-view";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

function resolveMonth(params: SearchParams, today: Date): Date {
  const raw = params.m;
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val && /^\d{4}-\d{2}$/.test(val)) {
    return parseLocalIsoDate(`${val}-01`);
  }
  return startOfMonth(today);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");

  const today = await getUserToday(user.id);
  const month = resolveMonth(await searchParams, today);
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });

  const from = format(gridStart, "yyyy-MM-dd");
  const to = format(gridEnd, "yyyy-MM-dd");

  const [configuration, txRows] = await Promise.all([
    loadFinancialConfiguration(user.id),
    db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, user.id),
          between(schema.transactions.date, from, to),
        ),
      ),
  ]);

  const paychecks = configuration.paydays(from, to);
  const paycheckSet = new Set(paychecks);

  const netByDay = new Map<string, { net: number; count: number }>();
  for (const t of txRows) {
    const cur = netByDay.get(t.date) ?? { net: 0, count: 0 };
    cur.net += t.amountCents;
    cur.count += 1;
    netByDay.set(t.date, cur);
  }

  const days: CalendarDay[] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    const key = format(cursor, "yyyy-MM-dd");
    const entry = netByDay.get(key);
    days.push({
      iso: key,
      day: cursor.getDate(),
      inMonth: cursor.getMonth() === month.getMonth(),
      isToday: isSameDay(cursor, today),
      isPayday: paycheckSet.has(key),
      netCents: entry?.net ?? 0,
      txCount: entry?.count ?? 0,
    });
    cursor = addDays(cursor, 1);
  }

  const monthIso = format(month, "yyyy-MM");
  const prevMonth = format(addDays(startOfMonth(month), -1), "yyyy-MM");
  const nextMonth = format(addDays(endOfMonth(month), 1), "yyyy-MM");
  const monthLabel = format(month, "MMMM yyyy");

  return (
    <CalendarView
      days={days}
      monthLabel={monthLabel}
      monthIso={monthIso}
      prevMonth={prevMonth}
      nextMonth={nextMonth}
    />
  );
}
