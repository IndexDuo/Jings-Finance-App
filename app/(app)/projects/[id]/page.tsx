import { getUserToday } from "@/lib/user-timezone";
import { notFound, redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { loadProjects } from "@/features/projects/server";
import { ProjectDetail } from "@/features/projects/components/project-detail";
import { format } from "date-fns";


export const dynamic = "force-dynamic";
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const project = (await loadProjects(user.id)).find(p => p.id === id && p.isProject);
  if (!project) notFound();
  return <ProjectDetail userId={user.id} project={project} today={format((await getUserToday(user.id)), "yyyy-MM-dd")} />;
}
