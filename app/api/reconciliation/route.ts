import { getUserToday } from "@/lib/user-timezone";
import { format } from "date-fns";

import { createClient } from "@/lib/supabase/server";
import { loadReconciliationReport } from "@/features/reconciliation/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
  const report = await loadReconciliationReport(user.id, format((await getUserToday(user.id)), "yyyy-MM-dd"));
  return Response.json(report, { headers });
  } catch { return Response.json({ error: "Could not load the report." }, { status: 500, headers }); }
}
