import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedTestDatabase } from "./pg-test-discipline";

const local = { CLIENT_ASSIGNMENT_TEST_DB: "1", NODE_ENV: "test" } as NodeJS.ProcessEnv;
const allowed = "postgresql://test:test@127.0.0.1:5432/monstera_ci";

test("test database guard accepts only explicit local or CI service targets", () => {
  assert.equal(assertAllowedTestDatabase(allowed, local), allowed);
  assert.equal(assertAllowedTestDatabase("postgresql://test:test@postgres:5432/monstera_e2e", { ...local, CI: "true" }), "postgresql://test:test@postgres:5432/monstera_e2e");
});

for (const [name, url, env] of [
  ["missing opt-in", allowed, {}],
  ["production-like name", "postgresql://test:test@localhost:5432/monstera_production_test", local],
  ["Neon host", "postgresql://test:test@ep-blue.neon.tech:5432/monstera_ci", local],
  ["unknown host", "postgresql://test:test@db.example.test:5432/monstera_ci", local],
  ["postgres outside CI", "postgresql://test:test@postgres:5432/monstera_ci", local],
  ["production environment", allowed, { ...local, NODE_ENV: "production" }],
  ["malformed URL", "not a URL", local],
] as const) {
  test(`test database guard rejects ${name}`, () => {
    assert.throws(() => assertAllowedTestDatabase(url, env as NodeJS.ProcessEnv));
  });
}
