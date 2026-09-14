-- CreateTable
CREATE TABLE "ReportSnapshotApproval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "generationKey" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "datasetFingerprint" TEXT NOT NULL,
    "dependencyHash" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "ReportSnapshotApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshotApproval_workspaceId_snapshotId_key" ON "ReportSnapshotApproval"("workspaceId", "snapshotId");

-- CreateIndex
CREATE INDEX "ReportSnapshotApproval_workspaceId_clientId_approvedAt_idx" ON "ReportSnapshotApproval"("workspaceId", "clientId", "approvedAt");

-- CreateIndex
CREATE INDEX "ReportSnapshotApproval_workspaceId_generationKey_sequence_idx" ON "ReportSnapshotApproval"("workspaceId", "generationKey", "sequence");

-- AddForeignKey
ALTER TABLE "ReportSnapshotApproval" ADD CONSTRAINT "ReportSnapshotApproval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshotApproval" ADD CONSTRAINT "ReportSnapshotApproval_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshotApproval" ADD CONSTRAINT "ReportSnapshotApproval_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReportSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshotApproval" ADD CONSTRAINT "ReportSnapshotApproval_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
