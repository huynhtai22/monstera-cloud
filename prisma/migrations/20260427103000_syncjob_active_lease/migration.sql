-- Add active uniqueness and lease metadata for SyncJob processing
ALTER TABLE "SyncJob"
ADD COLUMN "activeKey" TEXT,
ADD COLUMN "leaseId" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "heartbeatAt" TIMESTAMP(3);

-- New jobs should enforce one active (queued/running) job per pipeline.
-- Existing historical rows keep NULL activeKey to avoid retroactive conflicts.
CREATE UNIQUE INDEX "SyncJob_activeKey_key" ON "SyncJob"("activeKey");
CREATE INDEX "SyncJob_status_leaseExpiresAt_idx" ON "SyncJob"("status", "leaseExpiresAt");
