import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createImportJob,
  getImportJob,
  updateImportJob,
} from "./warehouse-import-job";

describe("Warehouse Import Job State Manager", () => {
  it("creates, retrieves, and updates an import job state", async () => {
    const jobId = `test_job_${Date.now()}`;
    const initial = await createImportJob({
      id: jobId,
      workspaceId: "test-workspace-123",
      since: "2026-01-01",
      until: "2026-01-30",
      totalItems: 3,
    });

    assert.equal(initial.id, jobId);
    assert.equal(initial.status, "queued");
    assert.equal(initial.totalItems, 3);
    assert.equal(initial.completedItems, 0);

    const fetched = await getImportJob(jobId);
    assert.ok(fetched);
    assert.equal(fetched?.workspaceId, "test-workspace-123");

    const updated = await updateImportJob(jobId, {
      status: "running",
      completedItems: 1,
      approximateRows: 150,
      results: [
        {
          connectionId: "conn-1",
          provider: "meta_ads",
          ok: true,
          upserted: 150,
        },
      ],
    });

    assert.ok(updated);
    assert.equal(updated?.status, "running");
    assert.equal(updated?.completedItems, 1);
    assert.equal(updated?.approximateRows, 150);
    assert.equal(updated?.results.length, 1);

    const completed = await updateImportJob(jobId, {
      status: "completed",
      completedItems: 3,
      approximateRows: 450,
    });

    assert.ok(completed);
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.completedItems, 3);
  });

  it("returns null when querying or updating non-existent job", async () => {
    const nonExistent = await getImportJob("non_existent_id_9999");
    assert.equal(nonExistent, null);

    const updateNonExistent = await updateImportJob("non_existent_id_9999", {
      status: "running",
    });
    assert.equal(updateNonExistent, null);
  });
});
