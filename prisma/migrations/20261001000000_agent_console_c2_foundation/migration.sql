-- CreateEnum
CREATE TYPE "AgentResponsibilityStatus" AS ENUM ('draft', 'active', 'paused', 'disabled');

-- CreateEnum
CREATE TYPE "AgentCaseState" AS ENUM ('detected', 'investigating', 'acting', 'verifying', 'needs_customer', 'blocked', 'failed', 'resolved');

-- CreateEnum
CREATE TYPE "AgentCasePriority" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "AgentOperationState" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'consumed');

-- CreateEnum
CREATE TYPE "AgentOutboxStatus" AS ENUM ('pending', 'delivering', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "AgentResponsibility" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'monitoring',
    "status" "AgentResponsibilityStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "scopeRevision" INTEGER NOT NULL DEFAULT 0,
    "policyRevision" INTEGER NOT NULL DEFAULT 0,
    "configuration" JSONB NOT NULL,
    "scopeHash" TEXT,
    "cadence" TEXT NOT NULL DEFAULT 'daily',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "nextDueAt" TIMESTAMP(3),
    "lastAttemptedAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentResponsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentResponsibilityScope" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "responsibilityId" TEXT NOT NULL,
    "scopeRevision" INTEGER NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "accountName" TEXT,
    "currency" TEXT,
    "timezone" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentResponsibilityScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAuthorization" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "responsibilityId" TEXT NOT NULL,
    "policyRevision" INTEGER NOT NULL,
    "scopeRevision" INTEGER NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "authorizingUserId" TEXT NOT NULL,
    "allowlistedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedPairs" JSONB NOT NULL DEFAULT '[]',
    "limits" JSONB,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvaluation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "responsibilityId" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "scopeRevision" INTEGER NOT NULL,
    "policyRevision" INTEGER NOT NULL,
    "scheduledSlot" TIMESTAMP(3) NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "windowSince" TIMESTAMP(3),
    "windowUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'no_finding',
    "qualityCode" TEXT,
    "blockerCode" TEXT,
    "evidenceId" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT,
    "responsibilityId" TEXT,
    "evaluationId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "episode" INTEGER NOT NULL DEFAULT 1,
    "ownerUserId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'metric_anomaly',
    "priority" "AgentCasePriority" NOT NULL DEFAULT 'medium',
    "state" "AgentCaseState" NOT NULL DEFAULT 'detected',
    "version" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requiredAction" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "resolutionType" TEXT,
    "resolutionReason" TEXT,
    "resolutionEvidenceId" TEXT,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentOperation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT,
    "evaluationId" TEXT,
    "operationKey" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "policyRevision" INTEGER NOT NULL,
    "state" "AgentOperationState" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "jobReference" TEXT,
    "receipt" JSONB,
    "error" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "proposalHash" TEXT NOT NULL,
    "approverUserId" TEXT,
    "evidenceFingerprint" TEXT NOT NULL,
    "evidenceRevision" INTEGER NOT NULL DEFAULT 1,
    "policyRevision" INTEGER NOT NULL,
    "scopeRevision" INTEGER NOT NULL,
    "status" "AgentApprovalStatus" NOT NULL DEFAULT 'pending',
    "isSingleUseConsumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "consumedByOperationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvidenceSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasetFingerprint" TEXT NOT NULL,
    "grain" TEXT NOT NULL DEFAULT 'campaign',
    "metrics" JSONB NOT NULL,
    "inventory" JSONB NOT NULL,
    "actualSince" TIMESTAMP(3) NOT NULL,
    "actualUntil" TIMESTAMP(3) NOT NULL,
    "currencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "provenance" JSONB NOT NULL,
    "citations" JSONB,
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvidenceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConsoleEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "responsibilityId" TEXT,
    "caseId" TEXT,
    "operationId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'system',
    "actorUserId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConsoleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentNotificationOutbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "recipientUserId" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "status" "AgentOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "receipt" JSONB,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentNotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentResponsibility_workspaceId_status_nextDueAt_idx" ON "AgentResponsibility"("workspaceId", "status", "nextDueAt");

-- CreateIndex
CREATE INDEX "AgentResponsibility_workspaceId_clientId_status_idx" ON "AgentResponsibility"("workspaceId", "clientId", "status");

-- CreateIndex
CREATE INDEX "AgentResponsibility_status_nextDueAt_idx" ON "AgentResponsibility"("status", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentResponsibility_workspaceId_id_key" ON "AgentResponsibility"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "AgentResponsibilityScope_workspaceId_responsibilityId_scope_idx" ON "AgentResponsibilityScope"("workspaceId", "responsibilityId", "scopeRevision");

-- CreateIndex
CREATE INDEX "AgentResponsibilityScope_workspaceId_connectionId_idx" ON "AgentResponsibilityScope"("workspaceId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentResponsibilityScope_responsibilityId_scopeRevision_con_key" ON "AgentResponsibilityScope"("responsibilityId", "scopeRevision", "connectionId", "providerAccountId");

-- CreateIndex
CREATE INDEX "AgentAuthorization_workspaceId_responsibilityId_policyRevis_idx" ON "AgentAuthorization"("workspaceId", "responsibilityId", "policyRevision");

-- CreateIndex
CREATE INDEX "AgentAuthorization_responsibilityId_expiresAt_idx" ON "AgentAuthorization"("responsibilityId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAuthorization_workspaceId_id_key" ON "AgentAuthorization"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAuthorization_responsibilityId_policyRevision_key" ON "AgentAuthorization"("responsibilityId", "policyRevision");

-- CreateIndex
CREATE INDEX "AgentEvaluation_workspaceId_responsibilityId_attemptedAt_idx" ON "AgentEvaluation"("workspaceId", "responsibilityId", "attemptedAt");

-- CreateIndex
CREATE INDEX "AgentEvaluation_responsibilityId_scheduledSlot_idx" ON "AgentEvaluation"("responsibilityId", "scheduledSlot");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvaluation_workspaceId_id_key" ON "AgentEvaluation"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvaluation_responsibilityId_scopeRevision_scheduledSlo_key" ON "AgentEvaluation"("responsibilityId", "scopeRevision", "scheduledSlot");

-- CreateIndex
CREATE INDEX "AgentCase_workspaceId_state_priority_idx" ON "AgentCase"("workspaceId", "state", "priority");

-- CreateIndex
CREATE INDEX "AgentCase_workspaceId_clientId_state_idx" ON "AgentCase"("workspaceId", "clientId", "state");

-- CreateIndex
CREATE INDEX "AgentCase_workspaceId_responsibilityId_state_idx" ON "AgentCase"("workspaceId", "responsibilityId", "state");

-- CreateIndex
CREATE INDEX "AgentCase_workspaceId_createdAt_id_idx" ON "AgentCase"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCase_workspaceId_id_key" ON "AgentCase"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCase_workspaceId_fingerprint_episode_key" ON "AgentCase"("workspaceId", "fingerprint", "episode");

-- CreateIndex
CREATE INDEX "AgentOperation_workspaceId_state_leaseExpiresAt_idx" ON "AgentOperation"("workspaceId", "state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AgentOperation_workspaceId_caseId_state_idx" ON "AgentOperation"("workspaceId", "caseId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AgentOperation_workspaceId_id_key" ON "AgentOperation"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentOperation_workspaceId_operationKey_key" ON "AgentOperation"("workspaceId", "operationKey");

-- CreateIndex
CREATE INDEX "AgentApproval_workspaceId_status_expiresAt_idx" ON "AgentApproval"("workspaceId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AgentApproval_workspaceId_operationId_idx" ON "AgentApproval"("workspaceId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApproval_workspaceId_id_key" ON "AgentApproval"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApproval_operationId_proposalHash_key" ON "AgentApproval"("operationId", "proposalHash");

-- CreateIndex
CREATE INDEX "AgentEvidenceSnapshot_workspaceId_datasetFingerprint_idx" ON "AgentEvidenceSnapshot"("workspaceId", "datasetFingerprint");

-- CreateIndex
CREATE INDEX "AgentEvidenceSnapshot_workspaceId_createdAt_idx" ON "AgentEvidenceSnapshot"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvidenceSnapshot_workspaceId_id_key" ON "AgentEvidenceSnapshot"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "AgentConsoleEvent_workspaceId_sequence_idx" ON "AgentConsoleEvent"("workspaceId", "sequence");

-- CreateIndex
CREATE INDEX "AgentConsoleEvent_workspaceId_responsibilityId_sequence_idx" ON "AgentConsoleEvent"("workspaceId", "responsibilityId", "sequence");

-- CreateIndex
CREATE INDEX "AgentConsoleEvent_workspaceId_caseId_sequence_idx" ON "AgentConsoleEvent"("workspaceId", "caseId", "sequence");

-- CreateIndex
CREATE INDEX "AgentConsoleEvent_workspaceId_createdAt_idx" ON "AgentConsoleEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConsoleEvent_workspaceId_id_key" ON "AgentConsoleEvent"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "AgentNotificationOutbox_workspaceId_status_createdAt_idx" ON "AgentNotificationOutbox"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentNotificationOutbox_status_createdAt_idx" ON "AgentNotificationOutbox"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentNotificationOutbox_workspaceId_id_key" ON "AgentNotificationOutbox"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentNotificationOutbox_workspaceId_deliveryKey_key" ON "AgentNotificationOutbox"("workspaceId", "deliveryKey");

-- AddForeignKey
ALTER TABLE "AgentResponsibility" ADD CONSTRAINT "AgentResponsibility_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentResponsibility" ADD CONSTRAINT "AgentResponsibility_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentResponsibility" ADD CONSTRAINT "AgentResponsibility_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentResponsibility" ADD CONSTRAINT "AgentResponsibility_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentResponsibilityScope" ADD CONSTRAINT "AgentResponsibilityScope_workspaceId_responsibilityId_fkey" FOREIGN KEY ("workspaceId", "responsibilityId") REFERENCES "AgentResponsibility"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentResponsibilityScope" ADD CONSTRAINT "AgentResponsibilityScope_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "Connection"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentResponsibilityScope" ADD CONSTRAINT "AgentResponsibilityScope_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAuthorization" ADD CONSTRAINT "AgentAuthorization_workspaceId_responsibilityId_fkey" FOREIGN KEY ("workspaceId", "responsibilityId") REFERENCES "AgentResponsibility"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAuthorization" ADD CONSTRAINT "AgentAuthorization_authorizingUserId_fkey" FOREIGN KEY ("authorizingUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAuthorization" ADD CONSTRAINT "AgentAuthorization_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_workspaceId_responsibilityId_fkey" FOREIGN KEY ("workspaceId", "responsibilityId") REFERENCES "AgentResponsibility"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "AgentEvidenceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCase" ADD CONSTRAINT "AgentCase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCase" ADD CONSTRAINT "AgentCase_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCase" ADD CONSTRAINT "AgentCase_workspaceId_responsibilityId_fkey" FOREIGN KEY ("workspaceId", "responsibilityId") REFERENCES "AgentResponsibility"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCase" ADD CONSTRAINT "AgentCase_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "AgentEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCase" ADD CONSTRAINT "AgentCase_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_workspaceId_caseId_fkey" FOREIGN KEY ("workspaceId", "caseId") REFERENCES "AgentCase"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "AgentEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_workspaceId_operationId_fkey" FOREIGN KEY ("workspaceId", "operationId") REFERENCES "AgentOperation"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidenceSnapshot" ADD CONSTRAINT "AgentEvidenceSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConsoleEvent" ADD CONSTRAINT "AgentConsoleEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConsoleEvent" ADD CONSTRAINT "AgentConsoleEvent_workspaceId_responsibilityId_fkey" FOREIGN KEY ("workspaceId", "responsibilityId") REFERENCES "AgentResponsibility"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConsoleEvent" ADD CONSTRAINT "AgentConsoleEvent_workspaceId_caseId_fkey" FOREIGN KEY ("workspaceId", "caseId") REFERENCES "AgentCase"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConsoleEvent" ADD CONSTRAINT "AgentConsoleEvent_workspaceId_operationId_fkey" FOREIGN KEY ("workspaceId", "operationId") REFERENCES "AgentOperation"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConsoleEvent" ADD CONSTRAINT "AgentConsoleEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNotificationOutbox" ADD CONSTRAINT "AgentNotificationOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNotificationOutbox" ADD CONSTRAINT "AgentNotificationOutbox_workspaceId_caseId_fkey" FOREIGN KEY ("workspaceId", "caseId") REFERENCES "AgentCase"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNotificationOutbox" ADD CONSTRAINT "AgentNotificationOutbox_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: One open case episode per fingerprint partial unique index
CREATE UNIQUE INDEX "AgentCase_workspaceId_fingerprint_open_idx" ON "AgentCase"("workspaceId", "fingerprint") WHERE "state" != 'resolved';


