"use client";

import { BadgeDollarSign, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
} from "react";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { tokens } from "@/styles/tokens";

// iOS Cycle Tracking-style day strip.
// Chose CSS scroll-snap + imperative scrollIntoView over embla-carousel: no extra
// dep, native momentum on touch, and snap behavior is declarative enough.

export type ActivityDot = "green" | "red" | "gray" | "blue";

export interface DayScrollerProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  /** ISO yyyy-MM-dd → dot color. Missing keys render no dot. */
  activityMap?: Map<string, ActivityDot>;
  /** Dates containing a note. Rendered alongside activity when both exist. */
  noteDates?: ReadonlySet<string>;
  /** Render a subtle payday badge on these dates. */
  paycheckDates?: Date[];
  /** Today in the user's local calendar. If omitted, falls back to `new Date()`.
   *  Used to draw a small dot under today's pill even when it's not selected. */
  todayDate?: Date;
  /** How many days render on either side of `selectedDate`. */
  radiusDays?: number;
  className?: string;
  showingCalendar?: boolean;
  onToggleCalendar?: () => void;
}

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DOT_COLOR: Record<ActivityDot, string> = {
  green: tokens.colors.systemGreen,
  red: tokens.colors.systemRed,
  // Tertiary label is only 30% opacity and disappeared against the gray day
  // pill. Notes need a visible neutral marker, not a nearly transparent one.
  gray: tokens.colors.secondaryLabel,
  blue: tokens.colors.systemBlue,
};

const isoKey = (d: Date) => format(d, "yyyy-MM-dd");

export function DayScroller({
  selectedDate,
  onDateChange,
  activityMap,
  noteDates,
  paycheckDates,
  todayDate,
  radiusDays = 30,
  className,
  showingCalendar = false,
  onToggleCalendar,
}: DayScrollerProps) {
  const today = todayDate ?? new Date();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const didMountRef = useRef(false);

  const paycheckKeys = useMemo(() => {
    const s = new Set<string>();
    paycheckDates?.forEach((d) => s.add(isoKey(d)));
    return s;
  }, [paycheckDates]);

  const days = useMemo(() => {
    const anchor = startOfDay(selectedDate);
    const out: Date[] = [];
    for (let i = -radiusDays; i <= radiusDays; i++) out.push(addDays(anchor, i));
    return out;
  }, [selectedDate, radiusDays]);

  // Center the selected pill whenever it changes. First pass jumps without
  // animation so the initial render doesn't show a visible scroll.
  useEffect(() => {
    const key = isoKey(selectedDate);
    const el = pillRefs.current.get(key);
    if (!el) return;
    const smooth = didMountRef.current;
    didMountRef.current = true;
    el.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      inline: "center",
      block: "nearest",
    });
  }, [selectedDate]);

  const move = useCallback(
    (delta: number) => {
      onDateChange(addDays(startOfDay(selectedDate), delta));
    },
    [selectedDate, onDateChange],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    }
  };

  const isSelectedToday = isSameDay(selectedDate, today);
  const isSelectedPayday = paycheckKeys.has(isoKey(selectedDate));

  const headerLabel = isSelectedToday
    ? `Today, ${format(selectedDate, "MMMM d")}`
    : format(selectedDate, "EEEE, MMMM d");

  return (
    <div className={cn("w-full select-none", className)}>
      <div className="flex items-center justify-between px-5 pb-2">
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            onClick={onToggleCalendar}
            className="flex items-center gap-1 min-w-0"
            aria-label={showingCalendar ? "Show day scroller" : "Show monthly calendar"}
          >
            <h2 className="text-[17px] font-semibold text-label truncate">{headerLabel}</h2>
            <ChevronDown
              className={cn(
                "w-4 h-4 text-tertiary-label shrink-0 transition-transform",
                showingCalendar ? "rotate-180" : "",
              )}
              aria-hidden
            />
          </button>
          {isSelectedPayday && (
            <span className="ml-1 inline-flex items-center gap-1 text-[12px] font-medium text-income whitespace-nowrap">
              <BadgeDollarSign className="h-3.5 w-3.5" aria-hidden />
              Payday
            </span>
          )}
        </div>
        {!isSelectedToday && (
          <button
            type="button"
            onClick={() => onDateChange(today)}
            className="shrink-0 text-[13px] font-medium text-system-blue active:opacity-60"
          >
            Go to today
          </button>
        )}
      </div>

      <div
        ref={scrollerRef}
        role="listbox"
        aria-label="Select day"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={cn(
          "flex gap-2 overflow-x-auto px-[50%] py-2 outline-none",
          "snap-x snap-mandatory scroll-smooth",
          "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
        )}
      >
        {days.map((day) => {
          const key = isoKey(day);
          const selected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, today);
          const dot = activityMap?.get(key);
          const hasNote = noteDates?.has(key) ?? false;
          const isPayday = paycheckKeys.has(key);
          const letter = WEEKDAY_LETTERS[day.getDay()];

          return (
            <button
              key={key}
              ref={(node) => {
                if (node) pillRefs.current.set(key, node);
                else pillRefs.current.delete(key);
              }}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={`${format(day, "EEEE, MMMM d")}${isPayday ? ", payday" : ""}${dot === "red" ? ", envelope over budget" : dot === "green" ? ", logged activity" : ""}${hasNote ? ", note" : ""}`}
              onClick={() => onDateChange(day)}
              className={cn(
                "relative snap-center shrink-0",
                "flex flex-col items-center justify-start gap-1.5",
                "h-[96px] w-12 rounded-pill",
                "transition-colors",
              )}
            >
              <span
                className={cn(
                  "text-[16px] font-medium",
                  selected
                    ? "text-label"
                    : isToday
                      ? "text-system-blue"
                      : "text-secondary-label",
                )}
              >
                {letter}
              </span>
              <span
                className={cn(
                  "flex items-center justify-center rounded-pill transition-[width,height,background-color] duration-150",
                  selected
                    ? "bg-label text-system-bg w-14 h-14 text-[22px] font-semibold"
                    : isToday
                      ? "bg-system-blue/10 text-system-blue w-12 h-[72px] text-[19px] font-semibold ring-1 ring-system-blue/40"
                      : isPayday
                        ? "bg-income/10 text-label w-12 h-[72px] text-[19px] ring-1 ring-income/30"
                        : "bg-secondary-system-bg text-label w-12 h-[72px] text-[19px]",
                )}
              >
                {format(day, "d")}
              </span>
              {isPayday && !selected && (
                <BadgeDollarSign
                  className="absolute right-0.5 top-7 h-3.5 w-3.5 text-income"
                  aria-hidden
                />
              )}
              {(dot || hasNote) && (
                <span className="absolute bottom-0 flex items-center gap-1" aria-hidden>
                  {dot && (
                    <span
                      className="h-2.5 w-2.5 rounded-full ring-2 ring-system-bg"
                      style={{ backgroundColor: DOT_COLOR[dot] }}
                    />
                  )}
                  {hasNote && dot !== "gray" && (
                    <span
                      className="h-2.5 w-2.5 rounded-full ring-2 ring-system-bg"
                      style={{ backgroundColor: DOT_COLOR.gray }}
                    />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
