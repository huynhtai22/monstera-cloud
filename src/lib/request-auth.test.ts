import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cronSecretEnvName, requireCronSecret, resolveCronSecret } from "./request-auth";

const master = "master-secret-0123456789abcdef0123456789";
const warehouse = "warehouse-secret-0123456789abcdef012345";

describe("scoped cron authentication", () => {
  it("maps each child scope to a separate environment variable", () => {
    assert.equal(cronSecretEnvName("master"), "CRON_SECRET");
    assert.equal(cronSecretEnvName("warehouse_jobs"), "CRON_SECRET_WAREHOUSE_JOBS");
  });

  it("does not inherit the shared secret in production by default", () => {
    assert.equal(resolveCronSecret("warehouse_jobs", {
      NODE_ENV: "production",
      CRON_SECRET: master,
    }), undefined);
    assert.equal(resolveCronSecret("warehouse_jobs", {
      NODE_ENV: "production",
      CRON_SECRET: master,
      CRON_SECRET_WAREHOUSE_JOBS: warehouse,
    }), warehouse);
  });

  it("allows the explicit temporary legacy switch", () => {
    assert.equal(resolveCronSecret("warehouse_jobs", {
      NODE_ENV: "production",
      CRON_SECRET: master,
      CRON_ALLOW_LEGACY_SHARED_SECRET: "1",
    }), master);
  });

  it("rejects a different job's otherwise valid token", () => {
    const originalWarehouse = process.env.CRON_SECRET_WAREHOUSE_JOBS;
    const originalHealth = process.env.CRON_SECRET_HEALTH_TICK;
    process.env.CRON_SECRET_WAREHOUSE_JOBS = warehouse;
    process.env.CRON_SECRET_HEALTH_TICK = "test-health-scope-credential-".padEnd(40, "x");
    try {
      const request = new Request("http://localhost/api/cron/health-tick", {
        headers: { Authorization: `Bearer ${warehouse}` },
      });
      assert.equal(requireCronSecret(request, "health_tick")?.status, 401);
    } finally {
      if (originalWarehouse === undefined) delete process.env.CRON_SECRET_WAREHOUSE_JOBS;
      else process.env.CRON_SECRET_WAREHOUSE_JOBS = originalWarehouse;
      if (originalHealth === undefined) delete process.env.CRON_SECRET_HEALTH_TICK;
      else process.env.CRON_SECRET_HEALTH_TICK = originalHealth;
    }
  });
});
