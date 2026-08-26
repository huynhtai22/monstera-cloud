-- CreateTable
CREATE TABLE "TikTokGmvMaxMetric" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL DEFAULT '',
    "storeId" TEXT NOT NULL,
    "storeName" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "campaignType" TEXT NOT NULL DEFAULT 'PRODUCT',
    "campaignId" TEXT NOT NULL DEFAULT '',
    "campaignName" TEXT NOT NULL DEFAULT '',
    "itemId" TEXT DEFAULT '',
    "itemName" TEXT,
    "itemGroupId" TEXT DEFAULT '',
    "itemGroupName" TEXT,
    "liveRoomId" TEXT DEFAULT '',
    "roomTitle" TEXT,
    "gmvMaxCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gmvMaxGrossRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gmvMaxOrders" INTEGER NOT NULL DEFAULT 0,
    "gmvMaxRoi" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT DEFAULT 'USD',
    "rawData" TEXT,
    "syncJobId" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TikTokGmvMaxMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TikTokGmvMaxMetric_workspaceId_storeId_date_idx" ON "TikTokGmvMaxMetric"("workspaceId", "storeId", "date");

-- CreateIndex
CREATE INDEX "TikTokGmvMaxMetric_connectionId_date_idx" ON "TikTokGmvMaxMetric"("connectionId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokGmvMaxMetric_connectionId_storeId_campaignId_itemId_liveRoomId_date_key" ON "TikTokGmvMaxMetric"("connectionId", "storeId", "campaignId", "itemId", "liveRoomId", "date");

-- AddForeignKey
ALTER TABLE "TikTokGmvMaxMetric" ADD CONSTRAINT "TikTokGmvMaxMetric_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TikTokGmvMaxMetric" ADD CONSTRAINT "TikTokGmvMaxMetric_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
