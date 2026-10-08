import { isDemoMode } from "@/lib/demo/config";
import { getAppAuthUser } from "@/lib/supabase/app-user";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDemoMode()) return new Response(null, { status: 404 });
  return Response.json({ active: Boolean(await getAppAuthUser()) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
