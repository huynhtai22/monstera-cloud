-- CreateTable
CREATE TABLE "WorkspaceAiPolicy" (
    "workspaceId" TEXT NOT NULL,
    "enabledFeatures" TEXT[] NOT NULL,
    "monthlyTokenBudget" INTEGER NOT NULL DEFAULT 2000000,
    "monthlyUsdBudget" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "budgetWriteOptIn" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgeBestEffortDefault" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAiPolicy_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "errorMsg" TEXT,
    "promptVersion" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refusalCode" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "leaseId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTrace" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "toolName" TEXT,
    "toolArgs" JSONB,
    "toolResult" JSONB,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePackRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "pack" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidencePackRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentJob_status_scheduledAt_idx" ON "AgentJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AgentJob_workspaceId_createdAt_idx" ON "AgentJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentJob_status_leaseExpiresAt_idx" ON "AgentJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AgentTrace_workspaceId_jobId_idx" ON "AgentTrace"("workspaceId", "jobId");

-- CreateIndex
CREATE INDEX "EvidencePackRecord_workspaceId_jobId_idx" ON "EvidencePackRecord"("workspaceId", "jobId");

-- AddForeignKey
ALTER TABLE "WorkspaceAiPolicy" ADD CONSTRAINT "WorkspaceAiPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTrace" ADD CONSTRAINT "AgentTrace_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePackRecord" ADD CONSTRAINT "EvidencePackRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
