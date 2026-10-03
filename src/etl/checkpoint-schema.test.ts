import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("SyncCheckpoint schema availability", () => {
  it("is repository-managed by the Prisma schema and baseline migration", () => {
    const root = process.cwd();
    const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const migration = fs.readFileSync(path.join(root, "prisma/migrations/20260401000000_baseline/migration.sql"), "utf8");
    assert.match(schema, /model\s+SyncCheckpoint\s+\{/);
    assert.match(migration, /CREATE TABLE "SyncCheckpoint"/);
    assert.match(migration, /CREATE INDEX "SyncCheckpoint_pipelineId_status_idx"/);
    assert.match(migration, /CREATE INDEX "SyncCheckpoint_jobId_idx"/);
  });
});
