CREATE TABLE "ClientFreshnessState" (
  "workspaceId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "incidentKey" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientFreshnessState_pkey" PRIMARY KEY ("workspaceId", "clientId"),
  CONSTRAINT "ClientFreshnessState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClientFreshnessState_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ClientFreshnessState_workspaceId_checkedAt_idx" ON "ClientFreshnessState"("workspaceId", "checkedAt");
