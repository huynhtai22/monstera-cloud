import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function loadDotEnv(fileName: string) {
  const filePath = path.join(__dirname, "../..", fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

export default async function globalSetup() {
  loadDotEnv(".env");
  loadDotEnv(".env.local");
  execFileSync("npx", ["tsx", "scripts/seed-two-tenant-rehearsal.ts"], {
    cwd: path.join(__dirname, "../.."),
    stdio: "inherit",
    env: process.env,
  });
}
