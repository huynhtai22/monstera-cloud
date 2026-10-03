-- CreateEnum
-- Additive milestone 1 only: existing OAuth and import execution are unchanged.
CREATE TYPE "WorkCategory" AS ENUM ('BUSINESS_OWNER', 'GROWTH_MARKETER', 'AGENCY_CONSULTANT', 'ECOMMERCE_SELLER', 'OPERATIONS_ANALYST', 'OTHER');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('in_progress', 'waiting_user', 'ready_to_review', 'completed', 'paused');

-- CreateEnum
CREATE TYPE "AgentTaskState" AS ENUM ('waiting_authorization', 'discovering_accounts', 'waiting_selection', 'queued', 'importing', 'verifying', 'ready', 'needs_attention', 'deferred');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "workCategory" "WorkCategory",
ADD COLUMN     "workContext" VARCHAR(500),
ADD COLUMN     "workProfileAnsweredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "initiatorUserId" TEXT NOT NULL,
    "clientId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'onboarding',
    "status" "AgentRunStatus" NOT NULL DEFAULT 'in_progress',
    "version" INTEGER NOT NULL DEFAULT 0,
    "resumeKey" TEXT,
    "lastEventSequence" INTEGER NOT NULL DEFAULT 0,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'connect_provider',
    "provider" TEXT NOT NULL,
    "state" "AgentTaskState" NOT NULL DEFAULT 'waiting_authorization',
    "reasonCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "scopeRevision" INTEGER NOT NULL DEFAULT 0,
    "requestedScope" JSONB,
    "confirmedScope" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "importJobId" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "selectedAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "AgentTaskConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "structuredResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_initiatorUserId_status_idx" ON "AgentRun"("workspaceId", "initiatorUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_workspaceId_id_key" ON "AgentRun"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_workspaceId_resumeKey_key" ON "AgentRun"("workspaceId", "resumeKey");

-- CreateIndex
CREATE INDEX "AgentTask_workspaceId_runId_state_idx" ON "AgentTask"("workspaceId", "runId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_workspaceId_id_key" ON "AgentTask"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_workspaceId_runId_id_key" ON "AgentTask"("workspaceId", "runId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_runId_taskKey_key" ON "AgentTask"("runId", "taskKey");

-- CreateIndex
CREATE INDEX "AgentTaskConnection_workspaceId_taskId_idx" ON "AgentTaskConnection"("workspaceId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTaskConnection_taskId_connectionId_key" ON "AgentTaskConnection"("taskId", "connectionId");

-- CreateIndex
CREATE INDEX "AgentRunMessage_workspaceId_runId_createdAt_idx" ON "AgentRunMessage"("workspaceId", "runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunMessage_runId_messageKey_key" ON "AgentRunMessage"("runId", "messageKey");

-- CreateIndex
CREATE INDEX "AgentRunEvent_workspaceId_runId_sequence_idx" ON "AgentRunEvent"("workspaceId", "runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunEvent_runId_sequence_key" ON "AgentRunEvent"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseImportJob_workspaceId_id_key" ON "WarehouseImportJob"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_initiatorUserId_fkey" FOREIGN KEY ("initiatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "AgentRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_workspaceId_importJobId_fkey" FOREIGN KEY ("workspaceId", "importJobId") REFERENCES "WarehouseImportJob"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskConnection" ADD CONSTRAINT "AgentTaskConnection_workspaceId_taskId_fkey" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "AgentTask"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskConnection" ADD CONSTRAINT "AgentTaskConnection_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "Connection"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunMessage" ADD CONSTRAINT "AgentRunMessage_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "AgentRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "AgentRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_workspaceId_runId_taskId_fkey" FOREIGN KEY ("workspaceId", "runId", "taskId") REFERENCES "AgentTask"("workspaceId", "runId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
