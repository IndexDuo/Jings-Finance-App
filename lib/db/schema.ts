import {
    pgTable,
    uuid,
    text,
    integer,
    boolean,
    date,
    timestamp,
    jsonb,
    uniqueIndex,
    pgPolicy,
    bigint,
    index,
    check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PayFrequency } from "@/lib/pay-schedule";

// Immutable completion receipt and source of genuinely released plan money.
// Not exposed in the UI until the release allocation flow is installed.
export const planCompletions = pgTable("plan_completions", {
    id: uuid("id").notNull().defaultRandom().unique(),
    goalId: uuid("goal_id").primaryKey().references(() => goals.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    finishedDate: date("finished_date").notNull(),
    startingCents: integer("starting_cents").notNull(),
    reservedCents: integer("reserved_cents").notNull(),
    releasedCents: integer("released_cents").notNull(),
    recoveryCents: integer("recovery_cents").notNull(),
    spentCents: integer("spent_cents").notNull(),
    releaseEventId: uuid("release_event_id").references(() => goalFundingEvents.id, { onDelete: "restrict" }),
    recoveryEventId: uuid("recovery_event_id").references(() => goalFundingEvents.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [pgPolicy("plan_completion_owner_read", {
    for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}`,
})]).enableRLS();

// Presentation metadata only. All amounts and purchases remain in goals and transactions.
export const projectViews = pgTable("project_views", {
    goalId: uuid("goal_id").primaryKey().references(() => goals.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    groups: jsonb("groups").$type<{ id: string; name: string }[]>().notNull().default([]),
    purchaseGroups: jsonb("purchase_groups").$type<Record<string, string>>().notNull().default({}),
}, table => [
    index("project_views_owner").on(table.userId),
    pgPolicy("project_views_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` }),
]).enableRLS();

// Trigger-maintained immutable history. No FK: source deletion must not erase evidence.
export const financialRecordHistory = pgTable("financial_record_history", {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id").notNull(),
    transactionId: text("transaction_id").notNull().default(sql`txid_current()::text`),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    operation: text("operation").notNull(),
    beforeRecord: jsonb("before_record"),
    afterRecord: jsonb("after_record"),
    actorUserId: uuid("actor_user_id"),
    databaseRole: text("database_role").notNull(),
    reason: text("reason"),
}, table => [
    index("financial_history_owner_id").on(table.userId, table.id.desc()),
    index("financial_history_record").on(table.userId, table.tableName, table.recordId, table.id),
    index("financial_history_transaction").on(table.userId, table.transactionId, table.id),
    check("financial_record_history_operation_check", sql`${table.operation} IN ('INSERT','UPDATE','DELETE')`),
    check("financial_record_history_check", sql`${table.beforeRecord} IS NOT NULL OR ${table.afterRecord} IS NOT NULL`),
    pgPolicy("financial_history_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` }),
]).enableRLS();

// User IDs are Supabase auth.users.id values. We mirror the row into public.users
// on first login from server code (no DB trigger). See lib/supabase/server.ts.
export const users = pgTable("users", {
    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [pgPolicy("users_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.id}` })]).enableRLS();

export const settings = pgTable("settings", {
    userId: uuid("user_id")
        .primaryKey()
        .references(() => users.id, { onDelete: "cascade" }),
    takeHomeCents: integer("take_home_cents").notNull(),
    payAnchorDate: date("pay_anchor_date").notNull(),
    payFrequency: text("pay_frequency").$type<PayFrequency>().notNull().default("biweekly"),
    semimonthlyDays: jsonb("semimonthly_days").$type<[number, number]>().notNull().default([15, 31]),
    timezone: text("timezone").notNull().default("UTC"),
    // User-specific boundary for app calculations and history. Pay anchor only
    // controls schedule phase; it must not double as an account start date.
    trackingStartDate: date("tracking_start_date").notNull().defaultNow(),
    // Bucket for leftover allocations the user marked as "guilt-free spending".
    // Withdrawn from when a transaction is tagged against the piggy bank.
    piggyBankCents: integer("piggy_bank_cents").notNull().default(0),
}, (table) => [pgPolicy("settings_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

// Immutable Settings history: legacy form snapshots are audit-only. Tagged
// financial-config-v1 snapshots contain resolved IDs and effective configuration
// for shared calculations; envelope amount policies retain their dated table.
export const financialSettingsRevisions = pgTable(
    "financial_settings_revisions",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        effectiveDate: date("effective_date").notNull(),
        snapshot: jsonb("snapshot").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    }, (table) => [pgPolicy("financial_settings_revisions_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

// frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
// due_day: day-of-month for monthly/quarterly/annual; null for weekly/biweekly
export const fixedExpenses = pgTable("fixed_expenses", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    frequency: text("frequency").notNull(),
    dueDay: integer("due_day"),
    // A real dated cycle replaces the old day-of-month-only model.
    lastPaidDate: date("last_paid_date"),
    nextDueDate: date("next_due_date"),
    // Removed bills are archived so linked payment history remains recoverable.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [pgPolicy("fixed_expenses_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

// period: 'weekly' | 'monthly'
// rollover_behavior: 'reset' | 'accumulate'
// overflow_envelope_id: when set, over-budget spend on this envelope is shown
// against that target envelope (e.g. dining-out overflow → groceries). Self-
// reference is allowed by the type but rejected at the form layer.
export const envelopes = pgTable("envelopes", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    periodAmountCents: integer("period_amount_cents").notNull(),
    period: text("period").notNull(),
    category: text("category").notNull(),
    rolloverBehavior: text("rollover_behavior").notNull(),
    // No FK here on purpose — `id` self-references would force two-step inserts.
    // We resolve overflow targets at read time with a simple id lookup.
    overflowEnvelopeId: uuid("overflow_envelope_id"),
    // 'recurring' | 'one-time'. One-time envelopes still appear in the /log
    // dropdown (so the user can re-categorize past spend or accidentally re-use)
    // but they are excluded from the paycheck waterfall and the /log weekly
    // banner — they don't deserve a budget slice every period.
    recurrence: text("recurrence").notNull().default("recurring"),
    // Special envelope for piggy bank spend-down. Excluded from paycheck budgets.
    isPiggy: boolean("is_piggy").notNull().default(false),
    // First date on which this envelope earns its recurring allowance. This is
    // an accrual anchor, not the date of the first purchase.
    accrualStartDate: date("accrual_start_date")
        .notNull()
        .defaultNow(),
    // Envelopes are archived instead of deleted so transactions and policy
    // history keep their identity forever.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [pgPolicy("envelopes_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

// Effective-dated allowance rules. Editing Settings appends a version rather
// than applying today's amount to past weeks/months.
export const envelopePolicyVersions = pgTable(
    "envelope_policy_versions",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        envelopeId: uuid("envelope_id")
            .notNull()
            .references(() => envelopes.id, { onDelete: "restrict" }),
        effectiveDate: date("effective_date").notNull(),
        periodAmountCents: integer("period_amount_cents").notNull(),
        period: text("period").notNull(),
        category: text("category").notNull(),
        rolloverBehavior: text("rollover_behavior").notNull(),
        recurrence: text("recurrence").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("envelope_policy_versions_envelope_effective_unique").on(
            table.envelopeId,
            table.effectiveDate,
        ), pgPolicy("envelope_policy_versions_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })],
).enableRLS();

// Allocation decisions retain the source (income entry or unused budget).
// Only a leftover row closes that period's leftover prompt. Income arriving
// later in the same period remains independently assignable.
export const paycheckAllocations = pgTable("paycheck_allocations", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    // First day of the paycheck period that just ended (the source of leftover).
    periodStartDate: date("period_start_date").notNull(),
    // Null identifies unused envelope budget. Income keeps its original Log
    // entry so assigning it twice or deleting its funding source is impossible.
    incomeTransactionId: uuid("income_transaction_id").references(
        () => transactions.id, { onDelete: "restrict" },
    ),
    releasedPlanId: uuid("released_plan_id").references(() => planCompletions.goalId, { onDelete: "restrict" }),
    releasedBillId: uuid("released_bill_id").references(() => billSettlements.id, { onDelete: "restrict" }),
    // The paycheck receiving the allocation, even for backdated income.
    // Null preserves legacy allocations' existing investment behavior.
    assignedPayDate: date("assigned_pay_date"),
    // 'goal' | 'envelope' | 'piggy' | 'investment' — where the leftover went.
    targetKind: text("target_kind").notNull(),
    // Set when targetKind === 'goal'. No FK so soft-deleted goals don't lose
    // their allocation history.
    goalId: uuid("goal_id"),
    // Set when targetKind === 'envelope'. No FK so later settings changes do
    // not erase the allocation record.
    envelopeId: uuid("envelope_id"),
    // Set when targetKind === 'recovery'. Kept as a soft reference so
    // completed-plan cleanup cannot erase allocation history.
    commitmentId: uuid("commitment_id"),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    pgPolicy("allocation_owner_read", {
        for: "select", to: "authenticated",
        using: sql`(select auth.uid()) = ${table.userId}`,
    }),
]).enableRLS();

// Append-only carry-in history for leftover money redirected into an
// envelope. Negative events are compensating corrections, never deletions.
export const envelopeFundingEvents = pgTable("envelope_funding_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    envelopeId: uuid("envelope_id").notNull(),
    envelopeName: text("envelope_name").notNull(),
    sourcePeriodStartDate: date("source_period_start_date").notNull(),
    targetPeriodStartDate: date("target_period_start_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [pgPolicy("envelope_funding_events_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

export const transactions = pgTable("transactions", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    category: text("category").notNull(),
    envelopeId: uuid("envelope_id").references(() => envelopes.id, {
        onDelete: "set null",
    }),
    fixedExpenseId: uuid("fixed_expense_id").references(
        () => fixedExpenses.id,
        { onDelete: "set null" },
    ),
    fixedExpenseDueDate: date("fixed_expense_due_date"),
    // Payment account only: 'cash' means bank/debit/cash; 'credit' means card.
    // It does not decide whether future money is needed.
    paymentMethod: text("payment_method").notNull().default("cash"),
    // 'covered' means the user already has money for this purchase.
    // 'needs-future-money' creates a dated payoff/recovery commitment.
    fundingStatus: text("funding_status").notNull().default("covered"),
    // Null preserves legacy treatment. New project purchases record their exact savings debit.
    planFundingCents: integer("plan_funding_cents"),
    // Optional plan this purchase advances. No FK on purpose: archived/deleted
    // plan history must not erase the transaction's original classification.
    goalId: uuid("goal_id"),
    note: text("note"),
}, (table) => [pgPolicy("transactions_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

// One durable record per occurrence of a fixed bill. Its linked Log entry can
// be edited without creating a second payment or losing the original cycle.
export const fixedExpensePayments = pgTable(
    "fixed_expense_payments",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        fixedExpenseId: uuid("fixed_expense_id")
            .notNull()
            .references(() => fixedExpenses.id, { onDelete: "restrict" }),
        dueDate: date("due_date").notNull(),
        paidDate: date("paid_date").notNull(),
        expectedCents: integer("expected_cents").notNull(),
        actualCents: integer("actual_cents").notNull(),
        transactionId: uuid("transaction_id").references(
            () => transactions.id,
            { onDelete: "set null" },
        ),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("fixed_expense_payments_user_bill_due_unique").on(
            table.userId,
            table.fixedExpenseId,
            table.dueDate,
        ),
        uniqueIndex("fixed_expense_payments_transaction_unique").on(
            table.transactionId,
        ), pgPolicy("fixed_expense_payments_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })],
).enableRLS();

// Append-only history for confirmations and later amount/date corrections.
// fixed_expense_payments is the current snapshot; this ledger is the audit trail.
export const fixedExpensePaymentEvents = pgTable(
    "fixed_expense_payment_events",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        paymentId: uuid("payment_id")
            .notNull()
            .references(() => fixedExpensePayments.id, {
                onDelete: "restrict",
            }),
        kind: text("kind").notNull(),
        amountDeltaCents: integer("amount_delta_cents").notNull(),
        paidDate: date("paid_date").notNull(),
        note: text("note"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    }, (table) => [pgPolicy("fixed_expense_payment_events_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

export const creditCardCommitments = pgTable("credit_card_commitments", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    sourceTransactionId: uuid("source_transaction_id")
        .references(() => transactions.id, { onDelete: "set null" })
        .unique(),
    // Set when an above-suggestion investment transfer came from cash that
    // should be rebuilt. Kept separate from source_transaction_id because an
    // investment transfer is not spending.
    sourceInvestmentTransferId: uuid("source_investment_transfer_id").unique(),
    name: text("name").notNull(),
    // 'card-payoff' for money still owed; 'checking-recovery' when the card
    // was already paid from checking and future investment should rebuild it.
    purpose: text("purpose").notNull().default("card-payoff"),
    // Destination rebuilt by an already-paid charge. Card payoffs leave this
    // at the default because the card itself is the destination.
    recoveryTarget: text("recovery_target").notNull().default("checking"),
    recoveryTargetLabel: text("recovery_target_label"),
    originalCents: integer("original_cents").notNull(),
    fundedCents: integer("funded_cents").notNull().default(0),
    dueDate: date("due_date").notNull(),
    // The first reserve is the payday strictly after this date.
    startDate: date("start_date").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [pgPolicy("credit_card_commitments_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

export const creditCardFundingEvents = pgTable(
    "credit_card_funding_events",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        commitmentId: uuid("commitment_id")
            .notNull()
            .references(() => creditCardCommitments.id, {
                onDelete: "restrict",
            }),
        kind: text("kind").notNull(),
        amountCents: integer("amount_cents").notNull(),
        payDate: date("pay_date"),
        note: text("note"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("credit_card_funding_commitment_payday_unique").on(
            table.commitmentId,
            table.payDate,
        ), pgPolicy("credit_card_funding_events_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })],
).enableRLS();

// storage_type: 'hysa' | 'conservative' | 'invested'
// emoji: a single grapheme the user picked from a preset (UI flavor, optional)
// color_key: one of the preset keys in features/goals/lib/accents.ts (optional)
// is_paused: when true, waterfall skips this goal (no per-paycheck contribution).
//   Goal still exists, still shows progress — just doesn't pull from paycheck.
export const goals = pgTable("goals", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetCents: integer("target_cents").notNull(),
    targetDate: date("target_date").notNull(),
    currentCents: integer("current_cents").notNull().default(0),
    storageType: text("storage_type").notNull(),
    emoji: text("emoji"),
    colorKey: text("color_key"),
    // On active plans, this activates the paycheck saving bucket. It is
    // exclusive so a just-received paycheck is never retroactively changed.
    savingStartDate: date("saving_start_date"),
    isPaused: boolean("is_paused").notNull().default(false),
    // Archived plans leave the active money flow but retain their target and
    // funding history. Passing a due date should never erase a plan.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [pgPolicy("goals_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

// A small ledger means automatic plan transfers remain exactly-once even when
// a person opens Plans or Paycheck more than once on a payday.
export const goalSavingTransfers = pgTable(
    "goal_saving_transfers",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        goalId: uuid("goal_id")
            .notNull()
            .references(() => goals.id, { onDelete: "cascade" }),
        payDate: date("pay_date").notNull(),
        amountCents: integer("amount_cents").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("goal_saving_transfers_user_goal_payday_unique").on(
            table.userId,
            table.goalId,
            table.payDate,
        ), pgPolicy("goal_saving_transfers_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })],
).enableRLS();

// Append-only plan funding history. goals.current_cents remains a cached
// balance for the paycheck waterfall, while this table preserves the source
// of that balance so a manual edit cannot erase Piggy or paycheck money.
export const goalFundingEvents = pgTable("goal_funding_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    // Plans are archived instead of deleted, retaining this complete history.
    goalId: uuid("goal_id")
        .notNull()
        .references(() => goals.id, { onDelete: "restrict" }),
    // opening-balance | manual | automatic-saving | paycheck-allocation |
    // piggy-transfer | recovery. Negative manual/allocation events are
    // compensating corrections rather than destructive history edits.
    kind: text("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [pgPolicy("goal_funding_events_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })]).enableRLS();

// What was actually transferred to investments for a paycheck period. The
// waterfall remains a recommendation; this ledger prevents the UI from
// silently treating that recommendation as money the user already moved.
export const investmentTransfers = pgTable(
    "investment_transfers",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        payPeriodStartDate: date("pay_period_start_date").notNull(),
        transferDate: date("transfer_date").notNull(),
        suggestedCents: integer("suggested_cents").notNull(),
        actualCents: integer("actual_cents").notNull(),
        // Only relevant when actual_cents exceeds suggested_cents.
        // future-investing | existing-cash | recovery | goal
        overageSource: text("overage_source").notNull().default("future-investing"),
        overageGoalId: uuid("overage_goal_id").references(() => goals.id, {
            onDelete: "set null",
        }),
        note: text("note"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("investment_transfers_user_period_unique").on(
            table.userId,
            table.payPeriodStartDate,
        ), pgPolicy("investment_transfers_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })],
).enableRLS();

// Exactly-once record of how much of an earlier investment advance was
// absorbed by a later paycheck. This prevents repeated page visits from
// reducing the recommendation more than once.
export const investmentAdvanceApplications = pgTable(
    "investment_advance_applications",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        payPeriodStartDate: date("pay_period_start_date").notNull(),
        amountCents: integer("amount_cents").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex("investment_advance_applications_user_period_unique").on(
            table.userId,
            table.payPeriodStartDate,
        ), pgPolicy("investment_advance_applications_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${table.userId}` })],
).enableRLS();

// Dated opt-in per bill. Old cycles and their unverified reserves are not imported.
export const billFundingPolicies = pgTable("bill_funding_policies", {
  id: uuid("id").notNull().defaultRandom().unique(),
  fixedExpenseId: uuid("fixed_expense_id").primaryKey().references(() => fixedExpenses.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  enrolledDate: date("enrolled_date").notNull(),
  legacyThroughDueDate: date("legacy_through_due_date").notNull(),
  activationPayDate: date("activation_pay_date"),
  cycleStartDate: date("cycle_start_date"),
  firstDueDate: date("first_due_date"),
  frequency: text("frequency").notNull(),
}, t => [pgPolicy("bill_policy_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${t.userId}` })]).enableRLS();

// One immutable batch per paycheck freezes funding before plans/recovery use it.
export const billFundingPaychecks = pgTable("bill_funding_paychecks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  payDate: date("pay_date").notNull(),
}, t => [uniqueIndex("bill_paycheck_owner_date").on(t.userId, t.payDate),
  pgPolicy("bill_paycheck_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${t.userId}` })]).enableRLS();

export const billFundingEvents = pgTable("bill_funding_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fixedExpenseId: uuid("fixed_expense_id").notNull().references(() => fixedExpenses.id, { onDelete: "restrict" }),
  payDate: date("pay_date").notNull(),
  dueDate: date("due_date").notNull(),
  expectedCents: integer("expected_cents").notNull(),
  requestedCents: integer("requested_cents").notNull(),
  amountCents: integer("amount_cents").notNull(),
}, t => [uniqueIndex("bill_funding_owner_occurrence_pay").on(t.userId, t.fixedExpenseId, t.dueDate, t.payDate),
  pgPolicy("bill_funding_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${t.userId}` })]).enableRLS();

// One conserved receipt per payment, including $0 releases. Not income.
export const billSettlements = pgTable("bill_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id").notNull().references(() => fixedExpensePayments.id, { onDelete: "restrict" }).unique(),
  fixedExpenseId: uuid("fixed_expense_id").notNull().references(() => fixedExpenses.id, { onDelete: "restrict" }),
  dueDate: date("due_date").notNull(),
  settledDate: date("settled_date").notNull(),
  reservedCents: integer("reserved_cents").notNull(),
  actualCents: integer("actual_cents").notNull(),
  usedCents: integer("used_cents").notNull(),
  releasedCents: integer("released_cents").notNull(),
  shortfallCents: integer("shortfall_cents").notNull(),
}, t => [uniqueIndex("bill_settlement_owner_occurrence").on(t.userId, t.fixedExpenseId, t.dueDate),
  pgPolicy("bill_settlement_owner_read", { for: "select", to: "authenticated", using: sql`(select auth.uid()) = ${t.userId}` })]).enableRLS();
