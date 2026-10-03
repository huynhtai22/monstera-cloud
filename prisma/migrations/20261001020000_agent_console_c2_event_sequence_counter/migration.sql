-- CreateTable
CREATE TABLE "AgentEventSequence" (
    "workspaceId" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentEventSequence_pkey" PRIMARY KEY ("workspaceId")
);

-- AddForeignKey
ALTER TABLE "AgentEventSequence" ADD CONSTRAINT "AgentEventSequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Populate initial sequence counters from existing events if any
INSERT INTO "AgentEventSequence" ("workspaceId", "lastSequence", "updatedAt")
SELECT "workspaceId", COALESCE(MAX("sequence"), 0), NOW()
FROM "AgentConsoleEvent"
GROUP BY "workspaceId"
ON CONFLICT ("workspaceId") DO NOTHING;
