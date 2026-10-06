"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, FolderOpen, Plus } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { ProjectRow } from "../server";
import { organizeProject } from "../actions";
import { card, money, rememberKey, sheetWidth } from "./shared";

export function ProjectList({ userId, plans, showList }: { userId: string; plans: ProjectRow[]; showList: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const projects = plans.filter(p => p.isProject);
  useEffect(() => {
    if (showList) return;
    try {
      const id = localStorage.getItem(rememberKey(userId));
      if (projects.some(p => p.id === id && !p.archived)) router.replace(`/projects/${id}`);
    } catch { /* Storage unavailable: keep the list usable. */ }
  }, [userId, showList, projects, router]);
  const status = (p: ProjectRow) => p.finished ? p.remainingCents > 0 ? "Awaiting funding" : "Completed" : p.archived ? "Archived" : "Active";
  function rows(section: string) {
    return projects.filter(p => status(p) === section).map(p => <Link key={p.id} href={`/projects/${p.id}`} className="flex min-h-20 items-center gap-4 border-b border-black/5 px-5 py-4 last:border-0">
      <span className="flex size-11 items-center justify-center rounded-xl bg-secondary-system-bg text-2xl" aria-hidden>{p.emoji || <FolderOpen size={22} />}</span>
      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{p.name}</span><span className="mt-1 block text-sm text-secondary-label">{section === "Awaiting funding" ? `${money(p.remainingCents)} still to cover` : p.archived ? `${money(p.spentCents)} spent` : `${money(p.availableCents)} available`}</span></span>
      <ChevronRight size={18} className="text-secondary-label" aria-hidden />
    </Link>);
  }
  return <main className="mx-auto max-w-xl px-5 pt-7 pb-28">
    <header className="mb-6 flex items-center justify-between"><h1 className="text-[28px] font-semibold">Projects</h1><button aria-label="Add project" onClick={() => { setError(""); setOpen(true); }} className="flex size-11 items-center justify-center text-system-blue"><Plus /></button></header>
    {projects.some(p => !p.archived) ? <div className={card}>{rows("Active")}</div> : <div className={`${card} p-6`}><h2 className="font-semibold">Keep a plan together</h2><p className="mt-2 text-sm text-secondary-label">Add a plan to see its spending and organize purchases.</p><button onClick={() => setOpen(true)} className="mt-4 min-h-11 text-system-blue font-medium">Add a project</button></div>}
    {["Awaiting funding", "Completed", "Archived"].map(section => projects.some(p => status(p) === section) && <section key={section} className="mt-8"><h2 className="mb-3 font-semibold">{section}</h2><div className={card}>{rows(section)}</div></section>)}
    <BottomSheet open={open} onClose={() => setOpen(false)} title="Add a project" className={sheetWidth}>
      <p className="mb-4 text-sm text-secondary-label">Choose a plan.</p>
      <div className={card}>{plans.filter(p => !p.isProject && !p.archived).map(p => <button key={p.id} disabled={pending} onClick={() => start(async () => {
        const result = await organizeProject({ kind: "add", goalId: p.id });
        if (!result.ok) setError(result.error); else { setOpen(false); router.push(`/projects/${p.id}`); router.refresh(); }
      })} className="flex min-h-14 w-full items-center justify-between border-b border-black/5 px-4 py-3 text-left last:border-0 disabled:opacity-50"><span>{p.name}</span><Plus size={18} className="text-system-blue" /></button>)}</div>
      {!plans.some(p => !p.isProject && !p.archived) && <p className="py-3 text-secondary-label">All your active plans are already here.</p>}
      {error && <p role="alert" className="mt-4 text-system-red">{error}</p>}
    </BottomSheet>
  </main>;
}
