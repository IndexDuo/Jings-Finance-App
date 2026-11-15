"use client";

import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Info, Pencil, Plus } from "lucide-react";
import { format } from "date-fns";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MoneyInput } from "@/components/ui/money-input";
import { parseLocalIsoDate } from "@/lib/dates";
import type { ProjectRow } from "../server";
import { editProject, organizeProject } from "../actions";
import { card, field, money, primary, rememberKey, sheetWidth } from "./shared";
import { PurchaseSheet } from "./purchase-sheet";
import { FinishSheet } from "./finish-sheet";

type Sheet = "edit" | "organize" | "move" | "funding" | null;

function ExpenseGroup({ preferenceKey, summary, children }: {
  preferenceKey: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const restoreExpansion = useCallback((details: HTMLDetailsElement | null) => {
    if (!details) return;
    try { details.open = localStorage.getItem(preferenceKey) === "open"; } catch { /* Optional preference. */ }
  }, [preferenceKey]);

  return <details ref={restoreExpansion} onToggle={event => {
    try {
      if (event.currentTarget.open) localStorage.setItem(preferenceKey, "open");
      else localStorage.removeItem(preferenceKey);
    } catch { /* Optional preference. */ }
  }} className="group border-b border-black/5 last:border-0">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-medium">
      {summary}
    </summary>
    {children}
  </details>;
}

export function ProjectDetail({ userId, project: p, today }: { userId: string; project: ProjectRow; today: string }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [finishing, setFinishing] = useState(false);
  const [purchase, setPurchase] = useState<ProjectRow["purchases"][number] | "new" | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [name, setName] = useState(p.name);
  const [budget, setBudget] = useState<number | null>(p.targetCents);
  const [date, setDate] = useState(p.targetDate);
  const [groupEdit, setGroupEdit] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [showGroupInput, setShowGroupInput] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [destination, setDestination] = useState<string | null>(null);
  const [movedCount, setMovedCount] = useState(0);
  useEffect(() => {
    if (!p.archived) { try { localStorage.setItem(rememberKey(userId), p.id); } catch { /* Optional preference. */ } }
  }, [userId, p.id, p.archived]);
  function open(next: Sheet) { setError(""); setMovedCount(0); setSheet(next); }
  function saveGroup() {
    start(async () => {
      const result = await organizeProject({ kind: "group", goalId: p.id, id: groupEdit ?? undefined, name: groupName });
      if (!result.ok) setError(result.error);
      else { setError(""); setShowGroupInput(false); setGroupName(""); setGroupEdit(null); router.refresh(); }
    });
  }
  function movePurchases() {
    setError("");
    setMovedCount(0);
    start(async () => {
      const result = await organizeProject({ kind: "move", goalId: p.id, groupId: destination, transactionIds: selected });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMovedCount(selected.length);
      setSelected([]);
      setDestination(null);
      router.refresh();
    });
  }
  const groupNames = new Map(p.groups.map(group => [group.id, group.name]));
  const groupRows = [...p.groups, { id: "other", name: "Other" }].map(group => ({
    ...group,
    purchases: p.purchases.filter(purchase =>
      (purchase.groupId && groupNames.has(purchase.groupId) ? purchase.groupId : "other") === group.id),
  }));
  return <main className="mx-auto max-w-xl px-5 pt-5 pb-28">
    <Link href="/projects?list=1" className="-ml-2 mb-3 inline-flex min-h-11 items-center text-system-blue"><ChevronLeft size={22} />Projects</Link>
    <header className="mb-5 flex items-center justify-between gap-3"><h1 className="text-[28px] font-semibold"><span aria-hidden>{p.emoji ? `${p.emoji} ` : ""}</span>{p.name}</h1>{!p.archived && <button aria-label="Edit project" className="flex size-11 shrink-0 items-center justify-center text-system-blue" onClick={() => { setName(p.name); setBudget(p.targetCents); setDate(p.targetDate); open("edit"); }}><Pencil size={21} /></button>}</header>
    <section className={`${card} p-5`} aria-label="Project summary">
      <div className="flex items-center justify-between"><h2 className="text-sm text-secondary-label">Available to spend</h2><button aria-label="Funding details" className="-my-2 -mr-2 flex size-10 items-center justify-center text-system-blue" onClick={() => open("funding")}><Info size={18} /></button></div>
      <p className="mt-1 text-[34px] font-semibold tracking-tight tabular-nums">{money(p.availableCents)}</p>
      <dl className="mt-5 grid grid-cols-2"><div className="border-r border-black/10"><dd className="text-lg font-semibold tabular-nums">{money(p.spentCents)}</dd><dt className="text-sm text-secondary-label">Spent</dt></div><div className="pl-5"><dd className="text-lg font-semibold tabular-nums">{money(p.targetCents)}</dd><dt className="text-sm text-secondary-label">Budget</dt></div></dl>
      <progress aria-label="Spent toward budget" max={Math.max(p.targetCents, p.spentCents, 1)} value={p.spentCents} className="mt-4 block h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-secondary-system-bg [&::-webkit-progress-value]:bg-system-blue [&::-moz-progress-bar]:bg-system-blue" />
    </section>
    <section className={`${card} mt-5`}>
      <header className="flex min-h-16 items-center justify-between border-b border-black/5 px-5"><h2 className="font-semibold">Expenses</h2>{!p.archived && <div className="flex items-center gap-2"><button className="min-h-11 text-sm font-medium text-system-blue" onClick={() => { setShowGroupInput(false); open("organize"); }}>Organize</button><button aria-label="Add purchase" className="flex size-11 items-center justify-center text-system-blue" onClick={() => setPurchase("new")}><Plus size={22} /></button></div>}</header>
      {p.purchases.length === 0 && <p className="px-5 py-6 text-sm text-secondary-label">Purchases linked to this plan will appear here.</p>}
      {groupRows.filter(g => g.purchases.length > 0).map(g => <ExpenseGroup
        key={g.id}
        preferenceKey={`projects:expense-group:${userId}:${p.id}:${g.id}`}
        summary={<><span>{g.name}</span><span className="flex items-center gap-3 tabular-nums">{money(-g.purchases.reduce((sum, t) => sum + t.amountCents, 0))}<ChevronRight size={16} aria-hidden className="text-secondary-label transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" /></span></>}
      >
        <ul className="pb-2">{g.purchases.map(t => <li key={t.id}><button disabled={p.archived} aria-label={`Edit ${t.note || "purchase"}`} onClick={() => setPurchase(t)} className="flex w-full items-start justify-between gap-4 px-5 py-3 text-left"><span className="min-w-0"><span className="block break-words text-[15px]">{t.note || "Purchase"}</span><span className="mt-1 block text-xs text-secondary-label">{format(parseLocalIsoDate(t.date), "MMM d, yyyy")}</span></span><span className="shrink-0 text-[15px] tabular-nums">{money(-t.amountCents)}</span></button></li>)}</ul>
      </ExpenseGroup>)}
    </section>
    {purchase !== null && <PurchaseSheet key={purchase === "new" ? "new" : purchase.id} project={p} purchase={purchase === "new" ? undefined : purchase} today={today} onClose={() => setPurchase(null)} />}
    {!p.archived && <button className="mt-5 min-h-11 w-full text-system-blue" onClick={() => setFinishing(true)}>Finish project</button>}
    {p.finished && <p className="mt-5 text-center text-sm text-secondary-label">{p.remainingCents > 0 ? `${money(p.remainingCents)} still to cover` : "Completed"}</p>}
    {p.finished && <Link href="/paycheck" className="mt-2 flex min-h-11 justify-center items-center text-system-blue">View Paycheck</Link>}
    {finishing && <FinishSheet goalId={p.id} name={p.name} onClose={() => setFinishing(false)} />}
    <BottomSheet open={sheet !== null} onClose={() => { if (!pending) setSheet(null); }} title={sheet === "edit" ? "Edit project" : sheet === "move" ? "Move purchases" : sheet === "funding" ? "Funding details" : "Organize expenses"} className={sheetWidth} autoFocusFirstElement={false}>
      {sheet === "edit" && <form className="space-y-5" onSubmit={e => { e.preventDefault(); start(async () => {
        const result = await editProject({ id: p.id, name, targetCents: budget, targetDate: date });
        if (!result.ok) setError(result.error); else { setSheet(null); router.refresh(); }
      }); }}>
        <label className="block text-sm text-secondary-label">Name<input required maxLength={64} className={field} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="block text-sm text-secondary-label">Budget<MoneyInput aria-label="Budget" required value={budget} onChange={setBudget} className={field} /></label>
        <label className="block text-sm text-secondary-label">Target date<input required type="date" className={field} value={date} onChange={e => setDate(e.target.value)} /></label>
        {error && <p role="alert" className="text-system-red">{error}</p>}
        <button disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Save changes"}</button>
      </form>}
      {sheet === "organize" && <div className="space-y-4">
        <div className={card}>{p.groups.map(g => <button key={g.id} onClick={() => { setGroupEdit(g.id); setGroupName(g.name); setShowGroupInput(true); setError(""); }} className="flex min-h-14 w-full items-center justify-between border-b border-black/5 px-4 text-left last:border-0" aria-label={`Rename ${g.name}`}><span>{g.name}</span><Pencil size={17} className="text-secondary-label" /></button>)}</div>
        <button className="inline-flex min-h-11 items-center gap-2 text-system-blue" onClick={() => { setGroupEdit(null); setGroupName(""); setShowGroupInput(true); setError(""); }}><Plus size={20} />Add group</button>
        {showGroupInput && <form onSubmit={e => { e.preventDefault(); saveGroup(); }}><label htmlFor="project-group-name" className="block text-sm text-secondary-label">{groupEdit ? "Group name" : "New group"}</label><div className="flex items-center gap-2"><input id="project-group-name" required maxLength={40} className={field} value={groupName} onChange={e => setGroupName(e.target.value)} /><button disabled={pending} className="mt-2 min-h-12 rounded-button bg-system-blue px-4 text-white disabled:opacity-50">{groupEdit ? "Save" : "Add"}</button></div></form>}
        {p.purchases.length > 0 && <button className={`${card} flex min-h-14 w-full items-center justify-between px-4 text-system-blue`} onClick={() => { setSelected([]); setDestination(null); open("move"); }}>Move purchases<ChevronRight size={18} /></button>}
        {error && <p role="alert" className="text-system-red">{error}</p>}
        <button disabled={pending} className={primary} onClick={() => setSheet(null)}>Done</button>
      </div>}
      {sheet === "move" && <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 text-system-blue">
          <button disabled={pending} className="min-h-11 disabled:opacity-50" onClick={() => open("organize")}>Back to groups</button>
          <button disabled={pending} className="min-h-11 disabled:opacity-50" onClick={() => setSheet(null)}>Done</button>
        </div>
        <fieldset disabled={pending} className={card} aria-label="Purchases to move">
          {p.purchases.map(t => <label key={t.id} className="flex min-h-14 items-center gap-3 border-b border-black/5 px-4 py-3 last:border-0">
            <input type="checkbox" checked={selected.includes(t.id)} onChange={event => {
              const checked = event.currentTarget.checked;
              setSelected(current => checked ? [...current, t.id] : current.filter(id => id !== t.id));
            }} className="size-5 shrink-0 accent-system-blue" />
            <span className="min-w-0 flex-1 break-words">
              <span className="block text-sm">{t.note || "Purchase"}</span>
              <span className="mt-0.5 block text-xs text-secondary-label">{groupNames.get(t.groupId ?? "") ?? "Other"}</span>
            </span>
            <span className="shrink-0 text-sm tabular-nums">{money(-t.amountCents)}</span>
          </label>)}
        </fieldset>
        <fieldset disabled={pending}><legend className="mb-2 text-sm text-secondary-label">Move to</legend><div className="flex flex-wrap gap-2">{[...p.groups, { id: "", name: "Other" }].map(g => <button key={g.id} aria-pressed={destination === (g.id || null)} onClick={() => setDestination(g.id || null)} className={`min-h-11 rounded-full border border-black/10 px-4 text-sm ${destination === (g.id || null) ? "bg-black text-white" : "bg-secondary-system-bg"}`}>{g.name}</button>)}</div></fieldset>
        {error && <p role="alert" className="text-system-red">{error}</p>}
        {movedCount > 0 && <p role="status" className="text-sm text-secondary-label">
          {movedCount === 1 ? "1 purchase moved." : `${movedCount} purchases moved.`}
        </p>}
        <button disabled={pending || selected.length === 0} className={primary} onClick={movePurchases}>{pending ? "Moving…" : "Move purchases"}</button>
      </div>}
      {sheet === "funding" && <dl className="space-y-4 py-2">{[["Funded toward plan", p.fundedCents], ["Still to fund", p.remainingCents], ["Available to spend", p.availableCents]].map(([label, amount]) => <div key={label} className="flex justify-between gap-3"><dt className="text-secondary-label">{label}</dt><dd className="font-medium tabular-nums">{money(Number(amount))}</dd></div>)}</dl>}
    </BottomSheet>
  </main>;
}
