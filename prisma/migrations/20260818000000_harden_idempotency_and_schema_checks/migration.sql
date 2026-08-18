-- CreateTable
CREATE TABLE IF NOT EXISTS "DataQualityRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ruleType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION,
    "pctThreshold" DOUBLE PRECISION,
    "pipelineId" TEXT,
    "connectionId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "notifyTelegram" BOOLEAN NOT NULL DEFAULT true,
    "expectedColumns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataQualityRule_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "DataQualityRule" ADD COLUMN IF NOT EXISTS "expectedColumns" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- DropIndex
DROP INDEX IF EXISTS "WarehouseImportJob_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseImportJob_workspaceId_idempotencyKey_key" ON "WarehouseImportJob"("workspaceId", "idempotencyKey");

