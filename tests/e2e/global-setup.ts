import { execFileSync } from "node:child_process";
import path from "node:path";
import { assertIsolatedE2eEnvironment } from "../../src/lib/e2e-env-guard";

// Security guard: Next.js automatically loads `.env` and `.env.local` from the server
// working directory regardless of Playwright webServer.env allowlists. To prevent
// accidental production credential or database leaks, we strictly refuse execution
// if any active environment file exists in the worktree. Only .env.example is permitted.
export { assertIsolatedE2eEnvironment };

export default async function globalSetup() {
  const root = path.join(__dirname, "../..");
  assertIsolatedE2eEnvironment(process.env, root);
  execFileSync("npx", ["tsx", "scripts/seed-two-tenant-rehearsal.ts"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}
