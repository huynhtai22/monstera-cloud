-- DropForeignKey
ALTER TABLE "AgentCase" DROP CONSTRAINT "AgentCase_evaluationId_fkey";

-- DropForeignKey
ALTER TABLE "AgentEvaluation" DROP CONSTRAINT "AgentEvaluation_evidenceId_fkey";

-- DropForeignKey
ALTER TABLE "AgentOperation" DROP CONSTRAINT "AgentOperation_evaluationId_fkey";

-- DropIndex
DROP INDEX "AgentConsoleEvent_workspaceId_sequence_idx";

-- CreateIndex
CREATE UNIQUE INDEX "AgentConsoleEvent_workspaceId_sequence_key" ON "AgentConsoleEvent"("workspaceId", "sequence");

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_workspaceId_evidenceId_fkey" FOREIGN KEY ("workspaceId", "evidenceId") REFERENCES "AgentEvidenceSnapshot"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCase" ADD CONSTRAINT "AgentCase_workspaceId_evaluationId_fkey" FOREIGN KEY ("workspaceId", "evaluationId") REFERENCES "AgentEvaluation"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_workspaceId_evaluationId_fkey" FOREIGN KEY ("workspaceId", "evaluationId") REFERENCES "AgentEvaluation"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
