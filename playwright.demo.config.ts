import { defineConfig, devices } from "@playwright/test";
import { assertSafeDemoTestEnvironment } from "./tests/demo/test-environment";

assertSafeDemoTestEnvironment();

export default defineConfig({
  testDir: "./tests/demo", timeout: 90000, expect: { timeout: 20000 }, workers: 1,
  fullyParallel: false, forbidOnly: Boolean(process.env.CI), retries: 0,
  reporter: [["list"]],
  use: { ...devices["iPhone 13"], browserName: "chromium", baseURL: "http://127.0.0.1:3102",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev -- --hostname 127.0.0.1 --port 3102", url: "http://127.0.0.1:3102/demo",
    reuseExistingServer: !process.env.CI, timeout: 120000,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL!,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY!, DATABASE_URL: process.env.E2E_DATABASE_URL!,
      FINANCE_DEMO_MODE: "true", DEMO_TURNSTILE_SITE_KEY: "" } },
});
