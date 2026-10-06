import { authResponse } from "@/lib/supabase/auth-response";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeAuthDestination } from "@/lib/supabase/auth-redirect";

/** Token-hash confirmation also works when email is opened in another browser. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  if (!token_hash || (type !== "email" && type !== "recovery"))
    return authResponse("/login?error=auth");
  const { error } = await (await createClient()).auth.verifyOtp({ token_hash, type });
  const destination = error ? "/login?error=auth" : type === "recovery" ? "/update-password" : safeAuthDestination(searchParams.get("next"));
  return authResponse(destination);
}
