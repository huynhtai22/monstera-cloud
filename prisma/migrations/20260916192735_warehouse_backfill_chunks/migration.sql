-- CreateTable
CREATE TABLE "WarehouseBackfillChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL DEFAULT '',
    "since" TEXT NOT NULL,
    "until" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "persistedRows" INTEGER NOT NULL DEFAULT 0,
    "leaseId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "fencingToken" BIGINT NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseBackfillChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseBackfillChunk_workspaceId_status_ordinal_idx" ON "WarehouseBackfillChunk"("workspaceId", "status", "ordinal");

-- CreateIndex
CREATE INDEX "WarehouseBackfillChunk_jobId_status_idx" ON "WarehouseBackfillChunk"("jobId", "status");

-- CreateIndex
CREATE INDEX "WarehouseBackfillChunk_jobId_ordinal_idx" ON "WarehouseBackfillChunk"("jobId", "ordinal");

-- CreateIndex
CREATE INDEX "WarehouseBackfillChunk_status_leaseExpiresAt_idx" ON "WarehouseBackfillChunk"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "WarehouseBackfillChunk_workspaceId_jobId_idx" ON "WarehouseBackfillChunk"("workspaceId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBackfillChunk_jobId_connectionId_accountId_since_u_key" ON "WarehouseBackfillChunk"("jobId", "connectionId", "accountId", "since", "until");

-- AddForeignKey
ALTER TABLE "WarehouseBackfillChunk" ADD CONSTRAINT "WarehouseBackfillChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseBackfillChunk" ADD CONSTRAINT "WarehouseBackfillChunk_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "WarehouseImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
