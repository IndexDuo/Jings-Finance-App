import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { todayInUserTz } from "@/lib/dates";

/** Pass the current transaction to avoid a second connection while holding locks. */
export async function getUserToday(userId: string, conn: Pick<typeof db, "select"> = db): Promise<Date> {
  const [settings] = await conn.select({ timezone: schema.settings.timezone }).from(schema.settings)
    .where(eq(schema.settings.userId, userId));
  return todayInUserTz(settings?.timezone ?? "UTC");
}
