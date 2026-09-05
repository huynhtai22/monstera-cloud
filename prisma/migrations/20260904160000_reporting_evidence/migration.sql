ALTER TABLE "Client" ADD COLUMN "requiredProviders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "requiredDestinations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "requirementsConfiguredAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Client_workspaceId_id_key" ON "Client"("workspaceId", "id");
CREATE UNIQUE INDEX "Connection_workspaceId_id_key" ON "Connection"("workspaceId", "id");
CREATE TABLE "AccountReportingContext" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "connectionId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
 "providerTimezone" TEXT, "providerCurrency" TEXT, "providerObservedAt" TIMESTAMP(3),
 "overrideTimezone" TEXT, "overrideCurrency" TEXT, "overrideReason" TEXT, "overrideBy" TEXT, "overrideAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AccountReportingContext_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "Connection"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AccountReportingContext_workspaceId_connectionId_accountId_key" ON "AccountReportingContext"("workspaceId", "connectionId", "accountId");
CREATE TABLE "DestinationDeliveryReceipt" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "destination" TEXT NOT NULL,
 "windowStart" TEXT NOT NULL, "windowEnd" TEXT NOT NULL, "dataThroughDate" TEXT NOT NULL,
 "datasetFingerprint" TEXT NOT NULL, "rowCount" INTEGER NOT NULL, "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "actorId" TEXT NOT NULL,
 CONSTRAINT "DestinationDeliveryReceipt_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DestinationDeliveryReceipt_workspaceId_clientId_windowStart_idx" ON "DestinationDeliveryReceipt"("workspaceId", "clientId", "windowStart", "windowEnd", "retrievedAt");
