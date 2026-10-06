import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { assertSafeE2eEnvironment } from "./tests/e2e/test-dataset";
import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

const envPath = resolve(process.cwd(), ".env.e2e.local");
if (existsSync(envPath)) loadEnv({ path: envPath, override: true, quiet: true });

assertSafeE2eEnvironment();

const testServerEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? "",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    actionTimeout: 20000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: testServerEnv,
  },
});
