import { z } from "zod";

/** PostgreSQL calendar dates: reject impossible dates and unsupported year zero. */
export const calendarDateSchema = z.iso.date({ error: "Use a valid YYYY-MM-DD date" })
  .refine(value => Number(value.slice(0, 4)) > 0, "Use a valid calendar year");
