-- CreateTable
CREATE TABLE "PayloadSchemaDiscovery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "schemaHash" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayloadSchemaDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayloadSchemaDiscovery_connectionId_schemaHash_key" ON "PayloadSchemaDiscovery"("connectionId", "schemaHash");

-- CreateIndex
CREATE INDEX "PayloadSchemaDiscovery_workspaceId_provider_discoveredAt_idx" ON "PayloadSchemaDiscovery"("workspaceId", "provider", "discoveredAt");

-- AddForeignKey
ALTER TABLE "PayloadSchemaDiscovery" ADD CONSTRAINT "PayloadSchemaDiscovery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
