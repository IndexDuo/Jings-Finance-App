import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { parse as parseEnv } from "dotenv";
import postgres from "postgres";

export const E2E_IDS = {
  rent: "10000000-0000-4000-8000-000000000001",
  utilities: "10000000-0000-4000-8000-000000000002",
  groceries: "20000000-0000-4000-8000-000000000001",
  fun: "20000000-0000-4000-8000-000000000002",
  dentalTransaction: "30000000-0000-4000-8000-000000000001",
  dentalRecovery: "40000000-0000-4000-8000-000000000001",
  completedRecovery: "40000000-0000-4000-8000-000000000002",
} as const;

const REQUIRED = [
  "E2E_SUPABASE_URL",
  "E2E_SUPABASE_ANON_KEY",
  "E2E_SUPABASE_SERVICE_ROLE_KEY",
  "E2E_DATABASE_URL",
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
] as const;

function required(name: (typeof REQUIRED)[number]): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is missing. Copy .env.e2e.example to .env.e2e.local and use a disposable local Supabase instance.`,
    );
  }
  return value;
}

export function assertSafeE2eEnvironment() {
  for (const name of REQUIRED) required(name);
  if (process.env.E2E_ALLOW_DATA_RESET !== "finance-app-e2e-only") {
    throw new Error(
      "E2E_ALLOW_DATA_RESET must equal finance-app-e2e-only before fictional test data can be created.",
    );
  }
  if (!required("E2E_USER_EMAIL").endsWith("@example.test")) {
    throw new Error("E2E_USER_EMAIL must end in @example.test.");
  }
  for (const name of ["E2E_SUPABASE_URL", "E2E_DATABASE_URL"] as const) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(required(name)).hostname)) {
      throw new Error(`${name} must point to a local disposable service.`);
    }
  }
  const normalEnvPath = resolve(process.cwd(), ".env.local");
  if (existsSync(normalEnvPath)) {
    const normalEnv = parseEnv(readFileSync(normalEnvPath));
    if (normalEnv.DATABASE_URL === required("E2E_DATABASE_URL")) {
      throw new Error("E2E_DATABASE_URL must not match .env.local DATABASE_URL.");
    }
    if (normalEnv.NEXT_PUBLIC_SUPABASE_URL === required("E2E_SUPABASE_URL")) {
      throw new Error(
        "E2E_SUPABASE_URL must not match the normal Supabase project in .env.local.",
      );
    }
  }
}

export function todayIso(timezone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function adminClient() {
  return createClient(
    required("E2E_SUPABASE_URL"),
    required("E2E_SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export async function ensureE2eAuthUser(): Promise<string> {
  assertSafeE2eEnvironment();
  const admin = adminClient();
  const email = required("E2E_USER_EMAIL");
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;
  const existing = listed.users.find((user) => user.email === email);
  if (existing) {
    if (existing.app_metadata?.finance_e2e !== true) throw new Error("Refusing to modify an unmarked test account.");
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: required("E2E_USER_PASSWORD"),
    email_confirm: true,
    app_metadata: { finance_e2e: true },
  });
  if (error) throw error;
  return data.user.id;
}

/** Fresh identities preserve immutable financial history; no teardown deletes data. */
export async function beginE2eTestAccount() {
  assertSafeE2eEnvironment();
  const prefix = required("E2E_USER_EMAIL").split("@")[0].slice(0,30);
  const email = `${prefix}-${randomUUID()}@example.test`;
  process.env.E2E_USER_EMAIL = email;
  Object.assign(E2E_IDS, Object.fromEntries(Object.keys(E2E_IDS).map(key => [key,randomUUID()])));
  const userId = await ensureE2eAuthUser();
  await prepareFinanceDataset(userId);
  return { userId, email, password: required("E2E_USER_PASSWORD") };
}

export async function prepareFinanceDataset(userId?: string): Promise<{
  userId: string;
  today: string;
  nextPayday: string;
}> {
  assertSafeE2eEnvironment();
  const resolvedUserId = userId ?? (await ensureE2eAuthUser());
  const { data, error } = await adminClient().auth.admin.getUserById(resolvedUserId);
  if (error || data.user.email !== required("E2E_USER_EMAIL") || data.user.app_metadata?.finance_e2e !== true)
    throw new Error("Refusing to seed an unverified disposable account.");
  const email = required("E2E_USER_EMAIL");
  const today = todayIso();
  const nextPayday = addIsoDays(today, 14);
  const sql = postgres(required("E2E_DATABASE_URL"), {
    prepare: false,
    max: 1,
  });

  try {
    const existing = await sql`select user_id from settings where user_id=${resolvedUserId}`;
    if (existing.length) return { userId: resolvedUserId, today, nextPayday };
    await sql.begin(async (tx) => {
      // Only a verified, marked test account can receive fictional fixture rows.
      await tx`
        insert into users (id, email)
        values (${resolvedUserId}, ${email})
      `;
      await tx`
        insert into settings (
          user_id, take_home_cents, pay_anchor_date, pay_frequency,
          tracking_start_date, timezone, piggy_bank_cents
        ) values (
          ${resolvedUserId}, 150000, ${today}, 'biweekly',
          ${today}, 'UTC', 0
        )
      `;
      await tx`
        insert into fixed_expenses (
          id, user_id, name, amount_cents, frequency, due_day,
          last_paid_date, next_due_date
        ) values
          (${E2E_IDS.rent}, ${resolvedUserId}, 'Rent', 60000, 'monthly', null, null, ${today}),
          (${E2E_IDS.utilities}, ${resolvedUserId}, 'Utilities', 12000, 'monthly', null, null, ${today})
      `;
      await tx`
        insert into envelopes (
          id, user_id, name, period_amount_cents, period, category,
          rollover_behavior, recurrence, is_piggy, accrual_start_date
        ) values
          (${E2E_IDS.groceries}, ${resolvedUserId}, 'Groceries', 30000, 'monthly', 'variable', 'reset', 'recurring', false, ${today}),
          (${E2E_IDS.fun}, ${resolvedUserId}, 'Fun money', 20000, 'monthly', 'guilt-free', 'accumulate', 'recurring', false, ${today})
      `;
      await tx`
        insert into envelope_policy_versions (
          user_id, envelope_id, effective_date, period_amount_cents,
          period, category, rollover_behavior, recurrence
        ) values
          (${resolvedUserId}, ${E2E_IDS.groceries}, ${today}, 30000, 'monthly', 'variable', 'reset', 'recurring'),
          (${resolvedUserId}, ${E2E_IDS.fun}, ${today}, 20000, 'monthly', 'guilt-free', 'accumulate', 'recurring')
      `;
    });
  } finally {
    await sql.end();
  }
  return { userId: resolvedUserId, today, nextPayday };
}

export async function readE2eRows<T>(query: (
  sql: postgres.Sql,
) => Promise<T>): Promise<T> {
  assertSafeE2eEnvironment();
  const sql = postgres(required("E2E_DATABASE_URL"), {
    prepare: false,
    max: 1,
  });
  try {
    return await query(sql);
  } finally {
    await sql.end();
  }
}

export async function seedPriorityPlanEditRegression(): Promise<{
  today: string;
}> {
  const { userId, today } = await prepareFinanceDataset();
  const dueDate = addIsoDays(today, 90);
  await readE2eRows(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`
        insert into transactions (
          id, user_id, date, amount_cents, category, payment_method,
          funding_status, note
        ) values (
          ${E2E_IDS.dentalTransaction}, ${userId}, ${today}, -50000,
          'variable', 'cash', 'needs-future-money', 'Sample dental expense'
        )
      `;
      await tx`
        insert into credit_card_commitments (
          id, user_id, source_transaction_id, name, purpose,
          recovery_target, original_cents, funded_cents, due_date,
          start_date, completed_at
        ) values
          (
            ${E2E_IDS.dentalRecovery}, ${userId}, ${E2E_IDS.dentalTransaction},
            'Sample dental expense', 'checking-recovery', 'emergency-fund',
            50000, 10000, ${dueDate}, ${today}, null
          ),
          (
            ${E2E_IDS.completedRecovery}, ${userId}, null,
            'Previously restored plan', 'checking-recovery', 'checking',
            30000, 30000, ${dueDate}, ${today}, now()
          )
      `;
      await tx`
        insert into credit_card_funding_events (
          user_id, commitment_id, kind, amount_cents, pay_date, note
        ) values
          (${userId}, ${E2E_IDS.dentalRecovery}, 'paycheck-reserve', 10000, ${today}, 'Fixture reserve'),
          (${userId}, ${E2E_IDS.completedRecovery}, 'paycheck-reserve', 30000, ${today}, 'Fixture completed reserve')
      `;
    });
  });
  return { today };
}
