import { redirect } from "next/navigation";
import { isDemoMode } from "@/lib/demo/config";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (isDemoMode()) redirect("/demo");
  return children;
}
