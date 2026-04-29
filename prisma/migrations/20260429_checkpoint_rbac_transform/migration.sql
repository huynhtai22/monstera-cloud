-- Migration: SyncCheckpoint + RBAC role enum + transform calculation fields

-- 1. Add SyncCheckpoint table for batch-level resume
CREATE TABLE IF NOT EXISTS "SyncCheckpoint" (
    id            TEXT PRIMARY KEY DEFAULT cuid(),
    pipelineId    TEXT NOT NULL,
    jobId         TEXT,
    entityType    TEXT NOT NULL DEFAULT 'campaign', -- campaign | order | account | custom
    cursor        TEXT NOT NULL, -- opaque JSON cursor
    rowsProcessed INTEGER NOT NULL DEFAULT 0,
    rowsInserted  INTEGER NOT NULL DEFAULT 0,
    rowsFailed    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active', -- active | completed | failed
    createdAt     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt     TIMESTAMP(3) NOT NULL,

    FOREIGN KEY (pipelineId) REFERENCES "Pipeline"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "SyncCheckpoint_pipelineId_status_idx" ON "SyncCheckpoint"(pipelineId, status);
CREATE INDEX IF NOT EXISTS "SyncCheckpoint_jobId_idx" ON "SyncCheckpoint"(jobId);

-- 2. Add transform calculation fields to existing TransformationRule table
ALTER TABLE "TransformationRule"
ADD COLUMN IF NOT EXISTS formula TEXT,         -- e.g. "spend * 1.2" or "revenue - cost"
ADD COLUMN IF NOT EXISTS targetField TEXT,     -- output field name in canonical schema
ADD COLUMN IF NOT EXISTS dependsOn TEXT[],     -- array of input field names
ADD COLUMN IF NOT EXISTS condition TEXT;        -- optional filter expression e.g. "platform == 'meta_ads'"

-- 3. Add explicit role enum check for WorkspaceMember
-- Note: Prisma doesn't natively support CHECK constraints, so we enforce via app layer
-- but we can add a partial index to speed up owner lookups
CREATE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_role_idx" ON "WorkspaceMember"(workspaceId, role)
WHERE role = 'owner';
