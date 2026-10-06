import { authResponse } from "@/lib/supabase/auth-response";
import { type NextRequest } from "next/server";

import { safeAuthDestination } from "@/lib/supabase/auth-redirect";
import { createClient } from "@/lib/supabase/server";

// Exchange a PKCE code for session cookies. The destination is an internal allowlist.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeAuthDestination(searchParams.get("next"));

  if (!code) {
    return authResponse("/login?error=missing_code");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user?.email) {
    return authResponse("/login?error=auth");
  }

  return authResponse(next);
}
