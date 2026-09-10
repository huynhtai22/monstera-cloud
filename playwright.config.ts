import { defineConfig, devices } from "@playwright/test";
import { validateE2eCommitSha } from "./src/lib/e2e-env-guard";

// Port is overridable so suites can run on a non-3000 port; default unchanged.
const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const commitSha = validateE2eCommitSha(process.env);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${port}`,
    url: `http://127.0.0.1:${port}/api/version`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // `npx next start` needs a home directory for its runtime cache. Keep it
      // explicit so the test server still receives no ambient credentials.
      HOME: process.env.HOME ?? "",
      HOSTNAME: "127.0.0.1",
      PORT: port,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      DIRECT_URL: process.env.DIRECT_URL ?? "",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-at-least-32-characters",
      NEXTAUTH_URL: `http://127.0.0.1:${port}`,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret-at-least-32-characters",
      GOOGLE_ID_TOKEN_AUDIENCES: "e2e-client.apps.googleusercontent.com",
      MONSTERA_E2E_ISOLATED: process.env.MONSTERA_E2E_ISOLATED ?? "",
      CLIENT_ASSIGNMENT_TEST_DB: process.env.CLIENT_ASSIGNMENT_TEST_DB ?? "",
      GIT_COMMIT_SHA: commitSha,
      PILOT_MODE: "1",
      ENABLE_GOVERNED_ANALYST: "1",
      NEXT_PUBLIC_ENABLE_GOVERNED_ANALYST: "1",
    },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
