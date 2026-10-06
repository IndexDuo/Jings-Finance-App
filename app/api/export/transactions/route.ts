import { csvText } from "@/lib/csv";
import { getUserToday } from "@/lib/user-timezone";
import { format } from "date-fns";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

// GET /api/export/transactions → CSV download of all the user's transactions.
// Columns: date, category, amount, envelope, note. Amount is signed dollars.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
  const [envelopeRows, txRows] = await Promise.all([
    db.select().from(schema.envelopes).where(eq(schema.envelopes.userId, user.id)),
    db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.userId, user.id))
      .orderBy(asc(schema.transactions.date), asc(schema.transactions.id)),
  ]);

  const envelopeById = new Map(envelopeRows.map((e) => [e.id, e.name]));

  const header = ["date", "category", "amount", "envelope", "note"].join(",");
  const lines = txRows.map((t) => {
    const envelope = t.envelopeId ? envelopeById.get(t.envelopeId) ?? "" : "";
    const amount = (t.amountCents / 100).toFixed(2);
    return [
      t.date,
      t.category,
      amount,
      csvText(envelope),
      csvText(t.note ?? ""),
    ].join(",");
  });

  const body = [header, ...lines].join("\n");
  const filename = `finance-transactions-${format(await getUserToday(user.id), "yyyy-MM-dd")}.csv`;

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  } catch { return NextResponse.json({error:"Could not export transactions."},{status:500,headers:{"Cache-Control":"private, no-store"}}); }
}
