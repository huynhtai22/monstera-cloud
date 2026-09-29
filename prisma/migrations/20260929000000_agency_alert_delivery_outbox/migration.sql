CREATE TABLE "AgencyAlertDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "pipelineName" TEXT NOT NULL,
    "clientId" TEXT,
    "errorMsg" TEXT NOT NULL,
    "actionHint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyAlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgencyAlertDelivery_workspaceId_idempotencyKey_key"
ON "AgencyAlertDelivery"("workspaceId", "idempotencyKey");
CREATE INDEX "AgencyAlertDelivery_status_availableAt_idx"
ON "AgencyAlertDelivery"("status", "availableAt");
CREATE INDEX "AgencyAlertDelivery_workspaceId_createdAt_idx"
ON "AgencyAlertDelivery"("workspaceId", "createdAt");
CREATE INDEX "AgencyAlertDelivery_status_leaseExpiresAt_idx"
ON "AgencyAlertDelivery"("status", "leaseExpiresAt");
CREATE INDEX "AgencyAlertDelivery_status_deliveredAt_idx"
ON "AgencyAlertDelivery"("status", "deliveredAt");

ALTER TABLE "AgencyAlertDelivery"
ADD CONSTRAINT "AgencyAlertDelivery_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
