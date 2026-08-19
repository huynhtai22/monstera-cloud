import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3000/api/version",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/monstera_e2e",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "e2e-nextauth-secret-at-least-32-characters",
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || "http://127.0.0.1:3000",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      CRON_SECRET: process.env.CRON_SECRET || "e2e-cron-secret-at-least-32-characters",
      GOOGLE_ID_TOKEN_AUDIENCES: process.env.GOOGLE_ID_TOKEN_AUDIENCES || "e2e-client.apps.googleusercontent.com",
      PILOT_MODE: "1",
    },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
