import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedE2eEnvironment } from "./global-setup";

const safe = { MONSTERA_E2E_ISOLATED: "1", CLIENT_ASSIGNMENT_TEST_DB: "1", DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/monstera_e2e", NODE_ENV: "test" } as NodeJS.ProcessEnv;
test("isolated E2E environment accepts only explicit loopback configuration", () => assert.doesNotThrow(() => assertIsolatedE2eEnvironment(safe, "/definitely-empty")));
test("isolated E2E environment rejects unsafe configuration", () => {
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, MONSTERA_E2E_ISOLATED: "" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, DATABASE_URL: "postgresql://x:x@remote.example/monstera_e2e" }, "/definitely-empty"));
  assert.throws(() => assertIsolatedE2eEnvironment({ ...safe, VERCEL_ENV: "production" }, "/definitely-empty"));
});
