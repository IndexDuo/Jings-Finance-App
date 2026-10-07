import { isDemoMode } from "@/lib/demo/config";
import { assertDemoInstallation } from "@/lib/demo/server";

export const dynamic = "force-dynamic";

/** No visitor records or connection details are returned by this readiness check. */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!isDemoMode()) return Response.json({ error: "Not found" }, { status: 404, headers });
  try {
    await assertDemoInstallation();
    return Response.json({ status: "ready" }, { headers });
  } catch (error) {
    let cause: unknown = error;
    let code = "UNAVAILABLE";
    // Drizzle wraps PostgreSQL errors; inspect only bounded error-code fields.
    for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
      if ("code" in cause && typeof cause.code === "string" && /^[A-Z0-9_]{1,64}$/.test(cause.code)) {
        code = cause.code;
        break;
      }
      cause = "cause" in cause ? cause.cause : undefined;
    }
    // PostgreSQL/TLS messages can contain connection details. Log only a bounded code.
    console.error("Demo database readiness failed:", code);
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
