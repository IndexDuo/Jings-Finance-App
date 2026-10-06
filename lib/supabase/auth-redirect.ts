const destinations = new Set(["/log", "/paycheck", "/onboarding", "/update-password"]);
export function safeAuthDestination(value: string | null): string {
  return value && destinations.has(value) ? value : "/log";
}
