-- Migration: SyncCheckpoint + RBAC role enum + transform calculation fields
-- NOTE: In PostgreSQL, unquoted identifiers are lowercased. Prisma uses quoted "camelCase"
-- column names — always quote them in raw SQL (see prisma/migrations/*_connection_identity_dedup).

-- 1. Add SyncCheckpoint table for batch-level resume
-- id has no DB default: Prisma supplies cuid() on insert (Postgres has no cuid() function).
CREATE TABLE IF NOT EXISTS "SyncCheckpoint" (
    "id"            TEXT NOT NULL,
    "pipelineId"    TEXT NOT NULL,
    "jobId"         TEXT,
    "entityType"    TEXT NOT NULL DEFAULT 'campaign',
    "cursor"        TEXT NOT NULL,
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted"  INTEGER NOT NULL DEFAULT 0,
    "rowsFailed"    INTEGER NOT NULL DEFAULT 0,
    "status"        TEXT NOT NULL DEFAULT 'active',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SyncCheckpoint_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SyncCheckpoint_pipelineId_status_idx" ON "SyncCheckpoint"("pipelineId", "status");
CREATE INDEX IF NOT EXISTS "SyncCheckpoint_jobId_idx" ON "SyncCheckpoint"("jobId");

-- 2. Add transform calculation fields to existing TransformationRule table
ALTER TABLE "TransformationRule"
ADD COLUMN IF NOT EXISTS "formula" TEXT,
ADD COLUMN IF NOT EXISTS "targetField" TEXT,
ADD COLUMN IF NOT EXISTS "dependsOn" TEXT[],
ADD COLUMN IF NOT EXISTS "condition" TEXT;

-- 3. Partial index for owner lookups (quoted columns match Prisma / PostgreSQL)
CREATE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_role_idx" ON "WorkspaceMember"("workspaceId", "role")
WHERE "role" = 'owner';
