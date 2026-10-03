-- AlterTable
ALTER TABLE "OAuthAttempt" ADD COLUMN "agentTaskId" TEXT;

-- CreateIndex
CREATE INDEX "OAuthAttempt_workspaceId_agentTaskId_idx" ON "OAuthAttempt"("workspaceId", "agentTaskId");

-- AddForeignKey
ALTER TABLE "OAuthAttempt" ADD CONSTRAINT "OAuthAttempt_workspaceId_agentTaskId_fkey" FOREIGN KEY ("workspaceId", "agentTaskId") REFERENCES "AgentTask"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
