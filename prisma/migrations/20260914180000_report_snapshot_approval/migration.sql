-- CreateTable
CREATE TABLE "ReportSnapshotApproval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshotApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshot_workspaceId_clientId_id_key" ON "ReportSnapshot"("workspaceId", "clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshotApproval_workspaceId_snapshotId_key" ON "ReportSnapshotApproval"("workspaceId", "snapshotId");

-- CreateIndex
CREATE INDEX "ReportSnapshotApproval_workspaceId_clientId_approvedAt_idx" ON "ReportSnapshotApproval"("workspaceId", "clientId", "approvedAt");

-- CreateIndex
CREATE INDEX "ReportSnapshotApproval_workspaceId_approvedByUserId_idx" ON "ReportSnapshotApproval"("workspaceId", "approvedByUserId");

-- AddForeignKey
ALTER TABLE "ReportSnapshotApproval" ADD CONSTRAINT "ReportSnapshotApproval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshotApproval" ADD CONSTRAINT "ReportSnapshotApproval_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshotApproval" ADD CONSTRAINT "ReportSnapshotApproval_workspaceId_clientId_snapshotId_fkey" FOREIGN KEY ("workspaceId", "clientId", "snapshotId") REFERENCES "ReportSnapshot"("workspaceId", "clientId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshotApproval" ADD CONSTRAINT "ReportSnapshotApproval_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
