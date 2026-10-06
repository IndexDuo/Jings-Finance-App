import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { loadProjects } from "@/features/projects/server";
import { ProjectList } from "@/features/projects/components/project-list";

export const dynamic = "force-dynamic";
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");
  return <ProjectList userId={user.id} plans={await loadProjects(user.id)} showList={(await searchParams).list === "1"} />;
}
