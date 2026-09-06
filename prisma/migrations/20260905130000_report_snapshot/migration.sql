-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "blueprintVersion" INTEGER NOT NULL,
    "generationKey" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reportingWindowStart" TIMESTAMP(3) NOT NULL,
    "reportingWindowEnd" TIMESTAMP(3) NOT NULL,
    "comparisonWindowStart" TIMESTAMP(3),
    "comparisonWindowEnd" TIMESTAMP(3),
    "reportingTimezone" TEXT,
    "reportingCurrency" TEXT,
    "requiredProviders" TEXT[],
    "requiredDestinations" TEXT[],
    "includedProviders" TEXT[],
    "includedAccountIds" TEXT[],
    "dataThroughByProvider" JSONB NOT NULL,
    "metricContractVersions" JSONB NOT NULL,
    "datasetFingerprint" TEXT NOT NULL,
    "readinessStatus" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "verificationReasons" TEXT[],
    "readinessEvidence" JSONB NOT NULL,
    "destinationReceipts" JSONB NOT NULL,
    "generatorCommitSha" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 2,
    "dependencyHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportSnapshot_workspaceId_clientId_generatedAt_idx" ON "ReportSnapshot"("workspaceId", "clientId", "generatedAt");


-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshot_generationKey_sequence_key" ON "ReportSnapshot"("generationKey", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshot_generationKey_dependencyHash_key" ON "ReportSnapshot"("generationKey", "dependencyHash");

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
