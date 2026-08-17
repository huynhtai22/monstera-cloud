-- CreateTable
CREATE TABLE "WarehouseImportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'pilot',
    "since" TEXT NOT NULL,
    "until" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "approximateRows" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "errorMsg" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "leaseId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseImportJob_idempotencyKey_key" ON "WarehouseImportJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WarehouseImportJob_workspaceId_status_idx" ON "WarehouseImportJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WarehouseImportJob_status_scheduledAt_idx" ON "WarehouseImportJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "WarehouseImportJob_status_leaseExpiresAt_idx" ON "WarehouseImportJob"("status", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "WarehouseImportJob" ADD CONSTRAINT "WarehouseImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
