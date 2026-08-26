-- CreateTable
CREATE TABLE "SchemaPatchProposal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "addedFields" TEXT NOT NULL,
    "removedFields" TEXT NOT NULL,
    "mappingDelta" TEXT NOT NULL,
    "breaking" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemaPatchProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchemaPatchProposal_workspaceId_status_createdAt_idx" ON "SchemaPatchProposal"("workspaceId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "SchemaPatchProposal" ADD CONSTRAINT "SchemaPatchProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
