-- CreateTable
CREATE TABLE "ClientReportingRequirement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requiredProviders" TEXT[],
    "requireDestination" BOOLEAN NOT NULL DEFAULT false,
    "reportingTimezone" TEXT,
    "reportingCurrency" TEXT,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientReportingRequirement_pkey" PRIMARY KEY ("id")
);

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
    "reportingTimezone" TEXT NOT NULL,
    "reportingCurrency" TEXT,
    "requiredProviders" TEXT[],
    "includedProviders" TEXT[],
    "includedAccountIds" TEXT[],
    "dataThroughByProvider" JSONB NOT NULL,
    "metricContractVersions" JSONB NOT NULL,
    "readinessStatus" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "verificationReasons" TEXT[],
    "readinessEvidence" JSONB NOT NULL,
    "destinationConnectionId" TEXT,
    "destinationEvidence" JSONB,
    "generatorCommitSha" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "dependencyHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientReportingRequirement_clientId_key" ON "ClientReportingRequirement"("clientId");

-- CreateIndex
CREATE INDEX "ClientReportingRequirement_clientId_idx" ON "ClientReportingRequirement"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReportingRequirement_workspaceId_clientId_key" ON "ClientReportingRequirement"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "ReportSnapshot_workspaceId_clientId_generatedAt_idx" ON "ReportSnapshot"("workspaceId", "clientId", "generatedAt");

-- CreateIndex
CREATE INDEX "ReportSnapshot_generationKey_dependencyHash_idx" ON "ReportSnapshot"("generationKey", "dependencyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshot_generationKey_sequence_key" ON "ReportSnapshot"("generationKey", "sequence");

-- AddForeignKey
ALTER TABLE "ClientReportingRequirement" ADD CONSTRAINT "ClientReportingRequirement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReportingRequirement" ADD CONSTRAINT "ClientReportingRequirement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
