import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const activeEnvFiles = [".env", ".env.local", ".env.test", ".env.test.local"];
export function assertIsolatedE2eEnvironment(env: NodeJS.ProcessEnv = process.env, root = path.join(__dirname, "../..")) {
  if (env.MONSTERA_E2E_ISOLATED !== "1" || env.CLIENT_ASSIGNMENT_TEST_DB !== "1") throw new Error("E2E requires explicit isolation flags.");
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") throw new Error("E2E refuses production environment markers.");
  if (activeEnvFiles.some((file) => fs.existsSync(path.join(root, file)))) throw new Error("E2E refuses active local .env files.");
  const url = new URL(env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/monstera_e2e") throw new Error("E2E requires loopback monstera_e2e.");
  for (const key of ["VERCEL", "NEON_API_KEY", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_SECRET", "TIKTOK_APP_SECRET", "SHOPEE_LIVE_PARTNER_KEY"]) if (env[key]) throw new Error(`E2E refuses ${key}.`);
}

export default async function globalSetup() {
  const root = path.join(__dirname, "../..");
  assertIsolatedE2eEnvironment(process.env, root);
  execFileSync("npx", ["tsx", "scripts/seed-two-tenant-rehearsal.ts"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}
