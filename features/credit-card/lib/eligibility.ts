import { isAfter } from "date-fns";

import { parseLocalIsoDate } from "@/lib/dates";

/** The configured start payday is inclusive. */
export function priorityPlanHasStarted(
  startDateIso: string,
  payDate: Date,
): boolean {
  return !isAfter(parseLocalIsoDate(startDateIso), payDate);
}
