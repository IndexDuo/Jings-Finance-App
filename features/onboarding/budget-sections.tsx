"use client";

import type { PaySchedule } from "@/lib/pay-schedule";

import { format } from "date-fns";
import { ChevronDown, Info, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { GroupedCard } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/money-input";
import { advanceFixedExpenseDueDate } from "@/features/fixed-expenses/lib/schedule";
import { proratePerPaycheck } from "@/features/paycheck/lib/proration";
import { parseLocalIsoDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  envelopeInputSchema,
  fixedExpenseInputSchema,
  type EnvelopeInput,
  type FixedExpenseInput,
} from "./schemas";

export const settingsInput =
  "h-12 min-w-0 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none focus-visible:ring-2 focus-visible:ring-system-blue";
export const settingsMoney = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const settingsDate = (date: string) =>
  date ? format(parseLocalIsoDate(date), "MMM d, yyyy") : "Not set";

export function SettingsField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-2">
      <span className="block text-[13px] font-medium text-secondary-label">
        {label}
      </span>
      {children}
    </label>
  );
}

export function SettingsSheet({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <BottomSheet
      open
      ariaLabel={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      autoFocusFirstElement={false}
      className="sm:left-1/2 sm:right-auto sm:max-w-xl sm:-translate-x-1/2"
    >
      <div className="flex items-center justify-between pb-5 pt-1">
        <h2 className="text-[20px] font-semibold text-label">{title}</h2>
        <button
          type="button"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center text-secondary-label"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {children}
    </BottomSheet>
  );
}

export function SettingsSave({
  busy,
  effectiveDate,
  label = "Save changes",
}: {
  busy: boolean;
  effectiveDate?: string;
  label?: string;
}) {
  return (
    <div className="sticky bottom-0 space-y-3 bg-system-bg pt-5 pb-1">
      {effectiveDate && (
        <p className="text-center text-[13px] text-secondary-label">
          Changes start {settingsDate(effectiveDate)}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="h-12 w-full rounded-button bg-system-blue text-[17px] font-medium text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : label}
      </button>
    </div>
  );
}

function Disclosure({
  title,
  children,
  subtitle,
}: {
  title: string;
  children: ReactNode;
  subtitle?: string;
}) {
  return (
    <details className="group rounded-card bg-secondary-system-bg p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="text-[15px] font-medium text-label">{title}</span>
          {subtitle && (
            <span className="mt-1 block text-[13px] text-secondary-label">
              {subtitle}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className="h-4 w-4 shrink-0 text-secondary-label group-open:rotate-180"
        />
      </summary>
      <div className="mt-5 space-y-5">{children}</div>
    </details>
  );
}

function ReserveInfo({
  label,
  amount,
  children,
}: {
  label: string;
  amount: number;
  children: ReactNode;
}) {
  return (
    <details className="border-t border-separator pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] [&::-webkit-details-marker]:hidden">
        <span className="font-medium text-label">{label}</span>
        <span className="flex items-center gap-2 text-secondary-label">
          <span className="tabular-nums">{settingsMoney(amount)}</span>
          <Info aria-hidden className="h-3.5 w-3.5 shrink-0" />
        </span>
      </summary>
      <div className="pt-2 text-[13px] text-secondary-label">{children}</div>
    </details>
  );
}

interface SectionProps<T> {
  items: T[];
  onChange?: (items: T[]) => void;
  onError: (message: string | null) => void;
  /** Settings commits one edit; onboarding keeps changes in its local draft. */
  onCommit?: (items: T[]) => Promise<string | null>;
  effectiveDate?: string;
  heading?: string;
  refillAnchors?: Record<string, string>;
}

function ListHeading({
  heading,
  label,
  onAdd,
}: {
  heading?: string;
  label: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      {heading && (
        <h1 className="font-ios text-[28px] font-semibold tracking-tight text-label">
          {heading}
        </h1>
      )}
      <button
        type="button"
        aria-label={label}
        onClick={onAdd}
        className={
          heading
            ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-system-blue text-white shadow-ios-card"
            : "flex min-h-11 items-center gap-2 text-[15px] font-medium text-system-blue"
        }
      >
        <Plus aria-hidden className={heading ? "h-6 w-6" : "h-5 w-5"} />
        {!heading && label}
      </button>
    </div>
  );
}

function useEditor<T>({ items, onChange, onCommit, onError }: SectionProps<T>) {
  const [index, setIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function report(message: string | null) {
    setError(message);
    onError(message);
  }
  function close() {
    setIndex(null);
    setRemoving(null);
    report(null);
  }
  async function commit(next: T[]) {
    setBusy(true);
    report(null);
    try {
      const failure = onCommit
        ? await onCommit(next)
        : (onChange?.(next), null);
      if (failure) report(failure);
      else close();
    } catch {
      report("Could not save. Your changes are still here. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return {
    index,
    setIndex,
    removing,
    setRemoving,
    error,
    busy,
    report,
    close,
    commit,
    save: (item: T) =>
      commit(
        index === -1
          ? [...items, item]
          : items.map((row, i) => (i === index ? item : row)),
      ),
  };
}

function RowActions({
  name,
  edit,
  remove,
}: {
  name: string;
  edit: () => void;
  remove: () => void;
}) {
  return (
    <div className="flex shrink-0">
      <button
        type="button"
        onClick={edit}
        aria-label={`Edit ${name}`}
        className="flex h-11 w-11 items-center justify-center text-secondary-label"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={remove}
        aria-label={`Remove ${name}`}
        className="flex h-11 w-11 items-center justify-center text-secondary-label hover:text-system-red"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function Removal({
  name,
  close,
  commit,
  busy,
  error,
  effectiveDate,
}: {
  name: string;
  close: () => void;
  commit: () => void;
  busy: boolean;
  error: string | null;
  effectiveDate?: string;
}) {
  return (
    <SettingsSheet title={`Remove ${name}?`} onClose={close} busy={busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <p className="text-[15px] text-secondary-label">
          {effectiveDate
            ? "Future budgets will stop. Existing logs and this paycheck stay unchanged."
            : "Remove this item from your setup."}
        </p>
        {error && (
          <p role="alert" className="mt-4 text-[13px] text-system-red">
            {error}
          </p>
        )}
        <SettingsSave
          busy={busy}
          effectiveDate={effectiveDate}
          label="Remove"
        />
      </form>
    </SettingsSheet>
  );
}

const frequencies: Record<FixedExpenseInput["frequency"], string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  biannual: "Every 6 months",
  annual: "Yearly",
};
const blankBill: FixedExpenseInput = {
  name: "",
  amountCents: 0,
  frequency: "monthly",
  dueDay: null,
  lastPaidDate: null,
  nextDueDate: null,
};

export function FixedExpensesSection(props: SectionProps<FixedExpenseInput> & { trackedBillIds?: string[]; paySchedule?: PaySchedule }) {
  const editor = useEditor(props);
  const [draft, setDraft] = useState<FixedExpenseInput>(blankBill);
  const [amount, setAmount] = useState<number | null>(null);
  function open(index: number) {
    const item = index < 0 ? blankBill : props.items[index];
    setDraft({ ...item });
    setAmount(index < 0 ? null : item.amountCents);
    editor.report(null);
    editor.setIndex(index);
  }
  function save() {
    if (!draft.nextDueDate) {
      editor.report("Choose the next due date.");
      return;
    }
    const parsed = fixedExpenseInputSchema.safeParse({
      ...draft,
      amountCents: amount ?? 0,
      dueDay: Number(draft.nextDueDate.slice(8, 10)),
    });
    if (!parsed.success) {
      editor.report(parsed.error.issues[0]?.message ?? "Check this bill.");
      return;
    }
    void editor.save(parsed.data);
  }
  return (
    <div className="space-y-6">
      <ListHeading
        heading={props.heading}
        label="Add bill"
        onAdd={() => open(-1)}
      />
      {props.items.length ? (
        <GroupedCard>
          <ul>
            {props.items.map((item, index) => (
              <li
                key={item.id ?? index}
                className="border-b border-separator px-5 py-4 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => open(index)}
                    className="min-w-0 text-left text-[17px] text-label"
                  >
                    {item.name}
                  </button>
                  <span className="shrink-0 text-[15px] tabular-nums text-label">
                    {settingsMoney(item.amountCents)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="text-[13px] text-secondary-label">
                    <p>{frequencies[item.frequency]}</p>
                    {item.nextDueDate && (
                      <p>Due {settingsDate(item.nextDueDate)}</p>
                    )}
                  </div>
                  <RowActions
                    name={item.name}
                    edit={() => open(index)}
                    remove={() => editor.setRemoving(index)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </GroupedCard>
      ) : (
        <p className="text-[15px] text-secondary-label">No bills yet.</p>
      )}
      {editor.index !== null && (
        <SettingsSheet
          title={editor.index < 0 ? "New bill" : "Edit bill"}
          onClose={editor.close}
          busy={editor.busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset disabled={editor.busy} className="min-w-0 space-y-6">
              <SettingsField label="Name">
                <input
                  aria-label="Name"
                  className={settingsInput}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="Amount">
                <MoneyInput
                  aria-label="Amount"
                  value={amount}
                  onChange={setAmount}
                />
              </SettingsField>
              <SettingsField label="Repeat">
                <select
                  aria-label="Repeat"
                  disabled={!!draft.id && props.trackedBillIds?.includes(draft.id)}
                  className={settingsInput}
                  value={draft.frequency}
                  onChange={(e) => {
                    const frequency = e.target
                      .value as FixedExpenseInput["frequency"];
                    setDraft({
                      ...draft,
                      frequency,
                      nextDueDate: draft.lastPaidDate
                        ? format(
                            advanceFixedExpenseDueDate(
                              parseLocalIsoDate(draft.lastPaidDate),
                              frequency,
                            ),
                            "yyyy-MM-dd",
                          )
                        : draft.nextDueDate,
                    });
                  }}
                >
                  {Object.entries(frequencies).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </SettingsField>
              <SettingsField label="Next due">
                <input
                  aria-label="Next due"
                  disabled={!!draft.id && props.trackedBillIds?.includes(draft.id)}
                  type="date"
                  className={settingsInput}
                  value={draft.nextDueDate ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, nextDueDate: e.target.value })
                  }
                />
              </SettingsField>
              <Disclosure
                title="Previous payment"
                subtitle={
                  draft.lastPaidDate
                    ? settingsDate(draft.lastPaidDate)
                    : "Optional"
                }
              >
                <SettingsField label="Last paid date">
                  <input
                    aria-label="Last paid date"
                    disabled={!!draft.id && props.trackedBillIds?.includes(draft.id)}
                    type="date"
                    className={settingsInput}
                    value={draft.lastPaidDate ?? ""}
                    onChange={(e) => {
                      const date = e.target.value;
                      setDraft({
                        ...draft,
                        lastPaidDate: date || null,
                        nextDueDate: date
                          ? format(
                              advanceFixedExpenseDueDate(
                                parseLocalIsoDate(date),
                                draft.frequency,
                              ),
                              "yyyy-MM-dd",
                            )
                          : draft.nextDueDate,
                      });
                    }}
                  />
                </SettingsField>
                <p className="text-[13px] text-secondary-label">
                  Changing this date updates the next due date.
                </p>
              </Disclosure>
              {draft.id && props.trackedBillIds?.includes(draft.id) ? (
                <p className="text-[13px] text-secondary-label">Reserved by due date. See Paycheck for the current contribution. The billing schedule is protected once tracking starts; confirm payments in Log. You can still update the budgeted amount.</p>
              ) : <ReserveInfo
                label="Reserved per paycheck"
                amount={proratePerPaycheck(
                  Math.max(0, amount ?? 0),
                  draft.frequency,
                  props.paySchedule,
                )}
              >
                <p className="text-[13px] text-secondary-label">
                  The yearly cost is spread across your scheduled paychecks. Actual payments
                  can adjust the amount reserved in a paycheck.
                </p>
              </ReserveInfo>}
              {editor.error && (
                <p role="alert" className="text-[13px] text-system-red">
                  {editor.error}
                </p>
              )}
              <SettingsSave
                busy={editor.busy}
                effectiveDate={props.effectiveDate}
                label={
                  props.onCommit
                    ? "Save changes"
                    : editor.index < 0
                      ? "Add bill"
                      : "Save"
                }
              />
            </fieldset>
          </form>
        </SettingsSheet>
      )}
      {editor.removing !== null && (
        <Removal
          name={props.items[editor.removing].name}
          close={editor.close}
          commit={() =>
            void editor.commit(
              props.items.filter((_, i) => i !== editor.removing),
            )
          }
          busy={editor.busy}
          error={editor.error}
          effectiveDate={props.effectiveDate}
        />
      )}
    </div>
  );
}

const blankEnvelope: EnvelopeInput = {
  name: "",
  periodAmountCents: 0,
  period: "monthly",
  category: "variable",
  rolloverBehavior: "reset",
  recurrence: "recurring",
  overflowEnvelopeId: null,
};

export function EnvelopesSection(props: SectionProps<EnvelopeInput> & { paySchedule?: PaySchedule }) {
  const editor = useEditor(props);
  const [draft, setDraft] = useState<EnvelopeInput>(blankEnvelope);
  const [amount, setAmount] = useState<number | null>(null);
  const recurring = draft.recurrence !== "one-time";
  const refillAnchor = draft.id
    ? props.refillAnchors?.[draft.id]
    : props.effectiveDate;
  const refillSchedule =
    draft.period === "weekly" && draft.rolloverBehavior === "accumulate"
      ? refillAnchor
        ? `Every ${format(parseLocalIsoDate(refillAnchor), "EEEE")}`
        : "Weekly from the first funding date"
      : "Every payday";
  function open(index: number) {
    const item = index < 0 ? blankEnvelope : props.items[index];
    setDraft({ ...item });
    setAmount(index < 0 ? null : item.periodAmountCents);
    editor.report(null);
    editor.setIndex(index);
  }
  function save() {
    if (amount === null) {
      editor.report(
        recurring
          ? "Enter an amount."
          : "Enter an amount, or 0 for no one-time funding.",
      );
      return;
    }
    const parsed = envelopeInputSchema.safeParse({
      ...draft,
      periodAmountCents: amount ?? 0,
    });
    if (!parsed.success) {
      editor.report(parsed.error.issues[0]?.message ?? "Check this envelope.");
      return;
    }
    void editor.save(parsed.data);
  }
  return (
    <div className="space-y-6">
      <ListHeading
        heading={props.heading}
        label="Add envelope"
        onAdd={() => open(-1)}
      />
      {props.items.length ? (
        <GroupedCard>
          <ul>
            {props.items.map((item, index) => (
              <li
                key={item.id ?? index}
                className="border-b border-separator px-5 py-4 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => open(index)}
                    className="min-w-0 text-left text-[17px] text-label"
                  >
                    {item.name}
                  </button>
                  {item.recurrence !== "one-time" && (
                    <span className="shrink-0 text-[15px] tabular-nums text-label">
                      {settingsMoney(item.periodAmountCents)}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                  <div className="flex flex-wrap gap-2 text-[12px]">
                    <span className="rounded-pill bg-secondary-system-bg px-2 py-1 text-secondary-label">
                      {item.recurrence === "one-time"
                        ? "One-time"
                        : item.period === "weekly"
                          ? "Weekly"
                          : "Monthly"}
                    </span>
                    <span
                      className={cn(
                        "rounded-pill px-2 py-1",
                        item.category === "guilt-free"
                          ? "bg-system-purple/10 text-system-purple"
                          : "bg-system-orange/10 text-label",
                      )}
                    >
                      {item.category === "guilt-free"
                        ? "Guilt-free"
                        : "Variable"}
                    </span>
                  </div>
                  <RowActions
                    name={item.name}
                    edit={() => open(index)}
                    remove={() => editor.setRemoving(index)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </GroupedCard>
      ) : (
        <p className="text-[15px] text-secondary-label">No envelopes yet.</p>
      )}
      {editor.index !== null && (
        <SettingsSheet
          title={editor.index < 0 ? "New envelope" : "Edit envelope"}
          onClose={editor.close}
          busy={editor.busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset disabled={editor.busy} className="min-w-0 space-y-6">
              <SettingsField label="Name">
                <input
                  aria-label="Name"
                  className={settingsInput}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </SettingsField>
              <div>
                <div className="flex items-center justify-between gap-4">
                  <span
                    className="text-[15px] font-medium text-label"
                    id="repeat-budget-label"
                  >
                    Repeat budget
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-labelledby="repeat-budget-label"
                    aria-checked={recurring}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        recurrence: recurring ? "one-time" : "recurring",
                      })
                    }
                    className={cn(
                      "flex h-8 w-14 shrink-0 items-center rounded-pill p-1 transition-colors",
                      recurring ? "bg-system-blue" : "bg-separator",
                    )}
                  >
                    <span
                      className={cn(
                        "h-6 w-6 rounded-full bg-white shadow-sm transition-transform",
                        recurring && "translate-x-6",
                      )}
                    />
                  </button>
                </div>
                <p className="mt-2 text-[13px] text-secondary-label">
                  Include in future paycheck budgets.
                </p>
              </div>
              {
                <div
                  className={recurring ? "grid grid-cols-2 gap-3" : "space-y-2"}
                >
                  <SettingsField
                    label={recurring ? "Amount" : "One-time amount"}
                  >
                    <MoneyInput
                      aria-label={recurring ? "Amount" : "One-time amount"}
                      value={amount}
                      onChange={setAmount}
                    />
                  </SettingsField>
                  {recurring && (
                    <SettingsField label="Period">
                      <select
                        aria-label="Period"
                        className={settingsInput}
                        value={draft.period}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            period: e.target.value as EnvelopeInput["period"],
                          })
                        }
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </SettingsField>
                  )}
                  {!recurring && (
                    <p className="text-[13px] text-secondary-label">
                      {props.items[editor.index ?? -1]?.recurrence ===
                      "one-time"
                        ? "Updates the original provision by the difference."
                        : "Added once when this change starts."}
                    </p>
                  )}
                </div>
              }
              <fieldset className="space-y-2">
                <legend className="mb-2 text-[13px] font-medium text-secondary-label">
                  Category
                </legend>
                <div className="grid grid-cols-2 rounded-button bg-secondary-system-bg p-1">
                  {(["variable", "guilt-free"] as const).map((category) => (
                    <label
                      key={category}
                      className={cn(
                        "cursor-pointer rounded-button px-2 py-3 text-center text-[15px]",
                        draft.category === category
                          ? category === "guilt-free"
                            ? "bg-system-purple/15 text-label"
                            : "bg-system-orange/15 text-label"
                          : "text-secondary-label",
                      )}
                    >
                      <input
                        className="sr-only peer"
                        type="radio"
                        name="category"
                        value={category}
                        checked={draft.category === category}
                        onChange={() => setDraft({ ...draft, category })}
                      />
                      <span className="peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-system-blue">
                        {category === "guilt-free" ? "Guilt-free" : "Variable"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {recurring && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-separator pt-5 text-[13px]">
                  <span className="font-medium text-label">Refills</span>
                  <span className="text-secondary-label">{refillSchedule}</span>
                </div>
              )}
              {recurring && (
                <ReserveInfo
                  label="Reserved per paycheck"
                  amount={proratePerPaycheck(
                    Math.max(0, amount ?? 0),
                    draft.period,
                    props.paySchedule,
                  )}
                >
                  <p className="text-[13px] text-secondary-label">
                    Your {draft.period} budget is converted to a share of each
                    scheduled paycheck. The refill schedule and money already
                    available remain separate from this reserve.
                  </p>
                </ReserveInfo>
              )}
              <Disclosure
                title="Leftover & overspending"
                subtitle={
                  draft.rolloverBehavior === "accumulate"
                    ? "Keep leftover"
                    : "Make leftover available to assign"
                }
              >
                <fieldset className="space-y-4">
                  <legend className="mb-3 text-[13px] font-medium text-label">
                    Leftover
                  </legend>
                  {(["accumulate", "reset"] as const).map((value) => (
                    <label
                      key={value}
                      className="flex items-start gap-3 text-[15px] text-label"
                    >
                      <input
                        type="radio"
                        name="leftover"
                        className="mt-1 h-4 w-4 accent-system-blue"
                        checked={draft.rolloverBehavior === value}
                        onChange={() =>
                          setDraft({ ...draft, rolloverBehavior: value })
                        }
                      />
                      <span>
                        {value === "accumulate"
                          ? "Keep in this envelope"
                          : "Make available to assign"}
                        <span className="mt-1 block text-[13px] text-secondary-label">
                          {value === "accumulate"
                            ? "Unused money and deficits carry forward."
                            : "Release unused money after the paycheck period."}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="border-t border-separator pt-5">
                  <SettingsField label="Cover overspending from">
                    <select
                      aria-label="Cover overspending from"
                      disabled={!draft.id}
                      className={settingsInput}
                      value={draft.overflowEnvelopeId ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          overflowEnvelopeId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">None</option>
                      {props.items
                        .filter((item) => item.id && item.id !== draft.id)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </SettingsField>
                  <p className="mt-2 text-[13px] text-secondary-label">
                    {draft.id
                      ? "Use another envelope to cover spending over budget."
                      : "Save this envelope first to choose where overspending is covered."}
                  </p>
                </div>
              </Disclosure>
              {!recurring && (
                <div className="rounded-card bg-secondary-system-bg p-4 text-[13px] leading-relaxed text-secondary-label">
                  Future recurring budgets stop. You can still log spending to
                  this envelope.
                  {props.effectiveDate && " This paycheck stays unchanged."}
                </div>
              )}
              {editor.error && (
                <p role="alert" className="text-[13px] text-system-red">
                  {editor.error}
                </p>
              )}
              <SettingsSave
                busy={editor.busy}
                effectiveDate={props.effectiveDate}
                label={
                  props.onCommit
                    ? "Save changes"
                    : editor.index < 0
                      ? "Add envelope"
                      : "Save"
                }
              />
            </fieldset>
          </form>
        </SettingsSheet>
      )}
      {editor.removing !== null && (
        <Removal
          name={props.items[editor.removing].name}
          close={editor.close}
          commit={() =>
            void editor.commit(
              props.items.filter((_, i) => i !== editor.removing),
            )
          }
          busy={editor.busy}
          error={editor.error}
          effectiveDate={props.effectiveDate}
        />
      )}
    </div>
  );
}
