-- AlterTable
ALTER TABLE "Client" ADD COLUMN "accountAssignmentsConfiguredAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Connection_workspaceId_id_provider_key" ON "Connection"("workspaceId", "id", "provider");

-- CreateTable
CREATE TABLE "ClientProviderAccountAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProviderAccountAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientProviderAccountAssignment_ws_prov_acc_key" ON "ClientProviderAccountAssignment"("workspaceId", "provider", "accountId");

-- CreateIndex
CREATE INDEX "ClientProviderAccountAssignment_ws_client_idx" ON "ClientProviderAccountAssignment"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "ClientProviderAccountAssignment_ws_conn_idx" ON "ClientProviderAccountAssignment"("workspaceId", "connectionId");

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_connectionId_p_fkey" FOREIGN KEY ("workspaceId", "connectionId", "provider") REFERENCES "Connection"("workspaceId", "id", "provider") ON DELETE CASCADE ON UPDATE CASCADE;
