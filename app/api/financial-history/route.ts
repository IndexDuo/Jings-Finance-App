import { createClient } from "@/lib/supabase/server";
import { loadFinancialHistory } from "@/features/reconciliation/history";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const before = params.get("before") ?? undefined;
  const recordId = params.get("recordId") ?? undefined;
  const transactionId = params.get("transactionId") ?? undefined;
  if ((before && (!/^\d{1,19}$/.test(before) || BigInt(before) > BigInt("9223372036854775807"))) ||
    (recordId && recordId.length > 64) || (transactionId && !/^\d{1,20}$/.test(transactionId))) {
    return Response.json({ error: "Invalid history filter" }, { status: 400, headers });
  }
  try { return Response.json(await loadFinancialHistory(user.id, { before, recordId, transactionId }), { headers }); }
  catch { return Response.json({ error: "Could not load financial history." }, { status: 500, headers }); }
}
