import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertIsolatedE2eEnvironment } from "./global-setup";

const safe: NodeJS.ProcessEnv = {
  MONSTERA_E2E_ISOLATED: "1",
  CLIENT_ASSIGNMENT_TEST_DB: "1",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/monstera_e2e",
  GIT_COMMIT_SHA: "154ca55b2afe27345d170fccfc4e773df3939310",
  NODE_ENV: "test",
};

test("isolated E2E environment accepts only explicit loopback configuration", () => {
  assert.doesNotThrow(() => assertIsolatedE2eEnvironment(safe, "/definitely-empty"));
});

test("isolated E2E environment accepts worktree containing only .env.example", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "monstera-e2e-example-"));
  try {
    fs.writeFileSync(path.join(tmpDir, ".env.example"), "FOO=bar\n");
    assert.doesNotThrow(() => assertIsolatedE2eEnvironment(safe, tmpDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("isolated E2E environment strictly rejects active .env.local even with sanitized env object", () => {
  // Security guard: Next.js automatically loads `.env.local` from the root directory.
  // Playwright webServer.env cannot guarantee isolation if active local env files exist.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "monstera-e2e-env-local-"));
  try {
    fs.writeFileSync(path.join(tmpDir, ".env.local"), "SECRET=val\n");
    assert.throws(
      () => assertIsolatedE2eEnvironment(safe, tmpDir),
      /E2E refuses active local \.env\.local file/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("isolated E2E environment strictly rejects active .env file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "monstera-e2e-dot-env-"));
  try {
    fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=val\n");
    assert.throws(
      () => assertIsolatedE2eEnvironment(safe, tmpDir),
      /E2E refuses active local \.env file/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("isolated E2E environment rejects unsafe configuration", () => {
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, MONSTERA_E2E_ISOLATED: "" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, CLIENT_ASSIGNMENT_TEST_DB: "" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, DATABASE_URL: "postgresql://x:x@remote.example/monstera_e2e" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, VERCEL_ENV: "production" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, VERCEL_ENV: "preview" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, NEXTAUTH_URL: "https://monsteracloud.com" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, GIT_COMMIT_SHA: undefined }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, GIT_COMMIT_SHA: "154ca55" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, GIT_COMMIT_SHA: "e2e-isolated-git-commit-sha" }, "/definitely-empty"));
});
