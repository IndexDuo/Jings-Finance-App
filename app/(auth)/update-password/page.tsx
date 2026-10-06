import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { AuthForm } from "@/features/auth/auth-form";
export default async function UpdatePasswordPage() {
  if (!await getVerifiedUser()) redirect("/reset-password");
  return <AuthForm mode="update"/>;
}
