-- Additive, bounded UTC-day counters used by the seat-sharing measurement framework.
CREATE TABLE "WorkspaceDailyUsage" (
    "workspaceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "queryCount" INTEGER NOT NULL DEFAULT 0,
    "importCount" INTEGER NOT NULL DEFAULT 0,
    "keyHitCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceDailyUsage_pkey" PRIMARY KEY ("workspaceId", "date")
);

CREATE INDEX "WorkspaceDailyUsage_date_idx" ON "WorkspaceDailyUsage"("date");

ALTER TABLE "WorkspaceDailyUsage"
ADD CONSTRAINT "WorkspaceDailyUsage_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
