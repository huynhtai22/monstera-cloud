CREATE TABLE "ShopeeCampaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "externalCampaignId" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "biddingStrategy" TEXT,
    "campaignName" TEXT,
    "campaignStatus" TEXT,
    "sourceRequestId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopeeCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopeeProduct" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "externalItemId" TEXT NOT NULL,
    "itemName" TEXT,
    "itemStatus" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceRequestId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopeeProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderSyncRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "shopId" TEXT,
    "endpoint" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "providerRequestId" TEXT,
    "status" TEXT NOT NULL,
    "rowsReceived" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ProviderSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopeeCatalogSyncState" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "productWatermarkAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopeeCatalogSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopeeCampaign_connectionId_environment_shopId_externalCampaignId_key" ON "ShopeeCampaign"("connectionId", "environment", "shopId", "externalCampaignId");
CREATE INDEX "ShopeeCampaign_workspaceId_environment_shopId_idx" ON "ShopeeCampaign"("workspaceId", "environment", "shopId");
CREATE INDEX "ShopeeCampaign_connectionId_syncedAt_idx" ON "ShopeeCampaign"("connectionId", "syncedAt");
CREATE UNIQUE INDEX "ShopeeProduct_connectionId_environment_shopId_externalItemId_key" ON "ShopeeProduct"("connectionId", "environment", "shopId", "externalItemId");
CREATE INDEX "ShopeeProduct_workspaceId_environment_shopId_idx" ON "ShopeeProduct"("workspaceId", "environment", "shopId");
CREATE INDEX "ShopeeProduct_connectionId_syncedAt_idx" ON "ShopeeProduct"("connectionId", "syncedAt");
CREATE INDEX "ProviderSyncRun_workspaceId_connectionId_startedAt_idx" ON "ProviderSyncRun"("workspaceId", "connectionId", "startedAt");
CREATE INDEX "ProviderSyncRun_connectionId_endpoint_startedAt_idx" ON "ProviderSyncRun"("connectionId", "endpoint", "startedAt");
CREATE UNIQUE INDEX "ShopeeCatalogSyncState_connectionId_key" ON "ShopeeCatalogSyncState"("connectionId");

ALTER TABLE "ShopeeCampaign" ADD CONSTRAINT "ShopeeCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopeeCampaign" ADD CONSTRAINT "ShopeeCampaign_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopeeProduct" ADD CONSTRAINT "ShopeeProduct_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopeeProduct" ADD CONSTRAINT "ShopeeProduct_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderSyncRun" ADD CONSTRAINT "ProviderSyncRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderSyncRun" ADD CONSTRAINT "ProviderSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopeeCatalogSyncState" ADD CONSTRAINT "ShopeeCatalogSyncState_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
