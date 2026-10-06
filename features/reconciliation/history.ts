import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Owner comes from server authentication, never a request parameter. */
export async function loadFinancialHistory(userId: string, filters: {
  before?: string; recordId?: string; transactionId?: string;
} = {}) {
  const rows = await db.select().from(schema.financialRecordHistory).where(and(
    eq(schema.financialRecordHistory.userId, userId),
    filters.before ? lt(schema.financialRecordHistory.id, BigInt(filters.before)) : undefined,
    filters.recordId ? eq(schema.financialRecordHistory.recordId, filters.recordId) : undefined,
    filters.transactionId ? eq(schema.financialRecordHistory.transactionId, filters.transactionId) : undefined,
  )).orderBy(desc(schema.financialRecordHistory.id)).limit(101);
  const page = rows.slice(0, 100).map(row => ({ ...row, id: String(row.id) }));
  return { entries: page, nextCursor: rows.length > 100 ? page.at(-1)!.id : null,
    coverage: "History begins with this fresh installation. Rows with the same transactionId committed together. Actor identity may be unavailable for server and automatic changes." };
}
