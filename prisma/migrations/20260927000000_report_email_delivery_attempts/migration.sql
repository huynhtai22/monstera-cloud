CREATE TABLE "ReportEmailDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "activeClaimKey" TEXT,
  "recipientDisplay" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "failureCode" TEXT,
  "providerStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportEmailDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportEmailDeliveryAttempt_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportEmailDeliveryAttempt_workspaceId_clientId_fkey"
    FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportEmailDeliveryAttempt_workspaceId_clientId_snapshotId_fkey"
    FOREIGN KEY ("workspaceId", "clientId", "snapshotId") REFERENCES "ReportSnapshot"("workspaceId", "clientId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportEmailDeliveryAttempt_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReportEmailDeliveryAttempt_activeClaimKey_key"
  ON "ReportEmailDeliveryAttempt"("activeClaimKey");
CREATE UNIQUE INDEX "ReportEmailDeliveryAttempt_workspaceId_idempotencyKey_key"
  ON "ReportEmailDeliveryAttempt"("workspaceId", "idempotencyKey");
CREATE INDEX "ReportEmailDeliveryAttempt_workspaceId_clientId_snapshotId__idx"
  ON "ReportEmailDeliveryAttempt"("workspaceId", "clientId", "snapshotId", "createdAt");
