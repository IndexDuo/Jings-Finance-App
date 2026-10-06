"use client";

import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { todayInUserTz } from "@/lib/dates";
import { useUserTimezone } from "./user-timezone";

/** Refresh dated server data when the user's calendar day changes. */
export function CalendarRefresh({ renderedDate }: { renderedDate: string }) {
  const router = useRouter();
  const timezone = useUserTimezone();
  const lastRequest = useRef({ date: "", at: -Infinity });

  useEffect(() => {
    function checkDate() {
      // Keep an open entry's draft and selected date intact until it closes.
      if (document.hidden || document.querySelector('[role="dialog"], dialog[open]')) return;
      const currentDate = format(todayInUserTz(timezone), "yyyy-MM-dd");
      if (currentDate === renderedDate) return;
      const now = performance.now();
      if (lastRequest.current.date === currentDate && now - lastRequest.current.at < 30_000) return;
      lastRequest.current = { date: currentDate, at: now };
      router.refresh();
    }

    checkDate();
    const timer = window.setInterval(checkDate, 60_000);
    window.addEventListener("focus", checkDate);
    document.addEventListener("visibilitychange", checkDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkDate);
      document.removeEventListener("visibilitychange", checkDate);
    };
  }, [renderedDate, router, timezone]);

  return null;
}
