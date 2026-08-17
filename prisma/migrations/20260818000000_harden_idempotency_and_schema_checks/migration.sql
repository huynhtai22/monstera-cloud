-- AlterTable
ALTER TABLE "DataQualityRule" ADD COLUMN IF NOT EXISTS "expectedColumns" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- DropIndex
DROP INDEX IF EXISTS "WarehouseImportJob_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseImportJob_workspaceId_idempotencyKey_key" ON "WarehouseImportJob"("workspaceId", "idempotencyKey");
