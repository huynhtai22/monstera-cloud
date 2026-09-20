import assert from "node:assert/strict";
import { it } from "node:test";
import { warehouseUsesDedicatedWorker } from "./warehouse-dispatch";
import { GET } from "@/app/api/cron/warehouse-jobs/route";

it("requires an explicit worker opt-in and preserves existing dispatch otherwise", () => {
  for (const value of [undefined, "", "serverless", "true", "WORKER"]) {
    assert.equal(warehouseUsesDedicatedWorker({ WAREHOUSE_EXECUTION_MODE: value }), false);
  }
  assert.equal(warehouseUsesDedicatedWorker({ WAREHOUSE_EXECUTION_MODE: "worker" }), true);
});

it("worker-mode queue cron authenticates and returns without touching the database", async () => {
  const oldMode = process.env.WAREHOUSE_EXECUTION_MODE;
  const oldSecret = process.env.CRON_SECRET_WAREHOUSE_JOBS;
  const secret = "synthetic-warehouse-cron-secret-for-test-only";
  process.env.WAREHOUSE_EXECUTION_MODE = "worker";
  process.env.CRON_SECRET_WAREHOUSE_JOBS = secret;
  try {
    const denied = await GET(new Request("http://localhost/api/cron/warehouse-jobs"));
    assert.equal(denied.status, 401);
    const response = await GET(new Request("http://localhost/api/cron/warehouse-jobs", {
      headers: { authorization: `Bearer ${secret}` },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { executionMode: "worker", executedJobs: [], processed: 0 });
  } finally {
    if (oldMode === undefined) delete process.env.WAREHOUSE_EXECUTION_MODE;
    else process.env.WAREHOUSE_EXECUTION_MODE = oldMode;
    if (oldSecret === undefined) delete process.env.CRON_SECRET_WAREHOUSE_JOBS;
    else process.env.CRON_SECRET_WAREHOUSE_JOBS = oldSecret;
  }
});
