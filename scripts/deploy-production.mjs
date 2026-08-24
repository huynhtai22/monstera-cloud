import { execFileSync, spawnSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const dirtyFiles = git(["status", "--porcelain"]);

if (dirtyFiles) {
  throw new Error("Refusing a production deployment from a dirty worktree. Commit or stash changes first.");
}

execFileSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: "inherit" });

const commitSha = git(["rev-parse", "HEAD"]);
const originMainSha = git(["rev-parse", "origin/main"]);

if (commitSha !== originMainSha) {
  throw new Error(
    `Refusing a production deployment outside origin/main. HEAD=${commitSha.slice(0, 7)} origin/main=${originMainSha.slice(0, 7)}`,
  );
}

const result = spawnSync(
  "npx",
  [
    "vercel",
    "deploy",
    "--prod",
    "--yes",
    "--build-env",
    `RELEASE_COMMIT_SHA=${commitSha}`,
    "--meta",
    "githubDeployment=1",
    "--meta",
    "githubCommitRef=main",
    "--meta",
    `githubCommitSha=${commitSha}`,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, RELEASE_COMMIT_SHA: commitSha },
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
