import { redirect } from "next/navigation";

// Root redirects to /paycheck (the main app view).
// Auth + onboarding gates are enforced in (app)/layout.tsx and (onboarding)/layout.tsx.
export default function Home() {
  redirect("/paycheck");
}
