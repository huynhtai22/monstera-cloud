import assert from "node:assert/strict";
import test from "node:test";
import { assertConnectorResilienceTestDatabase } from "@/lib/pg-test-discipline";

const safe = { CONNECTOR_RESILIENCE_TEST_DB: "1", DATABASE_URL: "postgresql://user:secret@127.0.0.1:55436/monstera_ci" } as NodeJS.ProcessEnv;

test("scheduler database discipline fails closed and never exposes URL credentials", () => {
  for (const env of [{ ...safe, CONNECTOR_RESILIENCE_TEST_DB: undefined }, { ...safe, CONNECTOR_RESILIENCE_TEST_DB: "0" }, { ...safe, CONNECTOR_RESILIENCE_TEST_DB: "false" }, { ...safe, DATABASE_URL: "postgresql://user:secret@127.0.0.1:5432/monstera_test" }, { ...safe, DATABASE_URL: "postgresql://user:secret@remote.example/monstera_ci" }, { ...safe, VERCEL_ENV: "production" }]) {
    assert.throws(() => assertConnectorResilienceTestDatabase(env), (error: Error) => !error.message.includes("secret"));
  }
});

test("scheduler database discipline accepts only monstera_ci on local loopback or exact CI service", () => {
  assert.equal(assertConnectorResilienceTestDatabase(safe), safe.DATABASE_URL);
  assert.equal(assertConnectorResilienceTestDatabase({ ...safe, CI: "true", DATABASE_URL: "postgresql://user:secret@postgres:5432/monstera_ci" }), "postgresql://user:secret@postgres:5432/monstera_ci");
  assert.throws(() => assertConnectorResilienceTestDatabase({ ...safe, DATABASE_URL: "postgresql://user:secret@postgres:5432/monstera_ci" }));
});
