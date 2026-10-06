"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MoneyInput } from "@/components/ui/money-input";
import { parseLocalIsoDate } from "@/lib/dates";
import type { ProjectRow } from "../server";
import { saveProjectPurchase } from "../purchase-actions";
import { computePurchaseFunding } from "../lib/purchase-funding";
import { field, money, primary, sheetWidth } from "./shared";

export function PurchaseSheet({ project, purchase, today, onClose }: {
  project: ProjectRow; purchase?: ProjectRow["purchases"][number]; today: string; onClose: () => void;
}) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState<number | null>(purchase ? -purchase.amountCents : null);
  const [description, setDescription] = useState(purchase?.note ?? "");
  const [group, setGroup] = useState(purchase?.groupId ?? null);
  const [payment, setPayment] = useState<"cash" | "credit">(purchase?.paymentMethod === "cash" ? "cash" : "credit");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const shortfall = !purchase && amount !== null
    ? computePurchaseFunding({ totalCents: amount, availableCents: project.availableCents }).shortfallCents : 0;
  return <BottomSheet open onClose={() => { if (!pending) onClose(); }} title={`${purchase ? "Edit" : "Add to"} ${format(parseLocalIsoDate(purchase?.date ?? today), "EEEE, MMMM d")}`} className={sheetWidth} autoFocusFirstElement={false}>
    <p className="mb-5 text-sm text-secondary-label">{project.name}</p>
    <form className="space-y-5" onSubmit={e => { e.preventDefault(); start(async () => {
      try {
        const result = await saveProjectPurchase({ requestId, id: purchase?.id, goalId: project.id, amountCents: amount, note: description, groupId: group, paymentMethod: payment });
        if (!result.ok) setError(result.error); else { router.refresh(); onClose(); }
      } catch { setError("Could not save. Check your connection and try again."); }
    }); }}>
      <label className="block text-sm text-secondary-label">Amount<MoneyInput aria-label="Amount" required value={amount} onChange={setAmount} className={field} /></label>
      <label className="block text-sm text-secondary-label">Description<input required maxLength={200} value={description} onChange={e => setDescription(e.target.value)} className={field} /></label>
      {project.groups.length > 0 && <fieldset><legend className="mb-2 text-sm text-secondary-label">Group (optional)</legend><div className="flex flex-wrap gap-2">{[...project.groups, { id: "", name: "Other" }].map(g => <button type="button" key={g.id} aria-pressed={group === (g.id || null)} onClick={() => setGroup(g.id || null)} className={`min-h-11 rounded-full border border-black/10 px-4 text-sm ${group === (g.id || null) ? "bg-black text-white" : "bg-secondary-system-bg"}`}>{g.name}</button>)}</div></fieldset>}
      <details><summary className="cursor-pointer py-2 text-sm text-system-blue">Payment details</summary><fieldset className="mt-2"><legend className="mb-2 text-sm text-secondary-label">Paid with</legend><div className="flex gap-2">{([['cash','Bank / cash'],['credit','Credit card']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={payment === value} onClick={() => setPayment(value)} className={`min-h-11 flex-1 rounded-button border border-black/10 text-sm ${payment === value ? "bg-black text-white" : "bg-secondary-system-bg"}`}>{label}</button>)}</div></fieldset></details>
      {shortfall > 0 && <p className="text-sm text-secondary-label">{money(shortfall)} will be covered by future paychecks.</p>}
      {error && <p role="alert" className="text-sm text-system-red">{error}</p>}
      <button disabled={pending} className={primary}>{pending ? "Saving…" : purchase ? "Save changes" : "Save"}</button>
    </form>
  </BottomSheet>;
}
