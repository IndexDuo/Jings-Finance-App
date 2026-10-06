import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isPayday: boolean;
  netCents: number;
  txCount: number;
}

interface CalendarViewProps {
  days: CalendarDay[];
  monthLabel: string;
  monthIso: string;
  prevMonth: string;
  nextMonth: string;
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function CalendarView({
  days,
  monthLabel,
  prevMonth,
  nextMonth,
}: CalendarViewProps) {
  return (
    <div className="min-h-svh bg-grouped-bg">
      <div className="mx-auto max-w-xl px-5 pt-4 pb-24">
        <div className="flex items-center justify-between">
          <Link
            href="/log"
            aria-label="Back to day log"
            className="w-9 h-9 rounded-pill flex items-center justify-center bg-secondary-system-bg"
          >
            <X className="w-4 h-4 text-label" aria-hidden />
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href={`/log/calendar?m=${prevMonth}`}
              aria-label="Previous month"
              className="w-9 h-9 rounded-pill flex items-center justify-center bg-secondary-system-bg"
            >
              <ChevronLeft className="w-4 h-4 text-label" aria-hidden />
            </Link>
            <Link
              href={`/log/calendar?m=${nextMonth}`}
              aria-label="Next month"
              className="w-9 h-9 rounded-pill flex items-center justify-center bg-secondary-system-bg"
            >
              <ChevronRight className="w-4 h-4 text-label" aria-hidden />
            </Link>
          </div>
        </div>

        <h1 className="mt-6 font-ios text-[28px] font-semibold tracking-tight text-label">
          {monthLabel}
        </h1>

        <div className="mt-6 grid grid-cols-7 gap-1 text-center text-[12px] font-medium text-secondary-label">
          {WEEKDAYS.map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1">
          {days.map((d) => (
            <DayCell key={d.iso} day={d} />
          ))}
        </div>

        <Legend />
      </div>
    </div>
  );
}

function DayCell({ day }: { day: CalendarDay }) {
  const hasActivity = day.txCount > 0;
  const dotColor = !hasActivity
    ? null
    : day.netCents >= 0
      ? "bg-system-green"
      : "bg-system-red";

  // Parse iso "yyyy-MM-dd" as local date to get the weekday.
  const [y, m, d] = day.iso.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const isWeekend = dow === 0 || dow === 6;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-start rounded-button py-2 min-h-14",
        day.inMonth
          ? isWeekend
            ? "bg-secondary-system-bg"
            : "bg-system-bg"
          : "bg-transparent",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center w-7 h-7 text-[13px]",
          day.isToday
            ? "rounded-pill bg-label text-system-bg font-semibold"
            : day.inMonth
              ? "text-label"
              : "text-tertiary-label",
        )}
      >
        {day.day}
      </span>
      {day.isPayday && day.inMonth && (
        <span className="mt-0.5 text-[10px] font-medium text-income">pay</span>
      )}
      {dotColor && (
        <span
          className={cn("absolute bottom-1 w-1.5 h-1.5 rounded-full", dotColor)}
          aria-hidden
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-4 text-[13px] text-secondary-label">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-system-green" aria-hidden />
        net income
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-system-red" aria-hidden />
        net spend
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-income font-medium">pay</span>
        payday
      </span>
    </div>
  );
}
