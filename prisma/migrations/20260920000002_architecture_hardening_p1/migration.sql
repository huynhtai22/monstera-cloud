-- Workspace-authorized device evidence. Identity telemetry remains global;
-- this separate table is the only device evidence exposed to tenant admins.
CREATE TABLE "WorkspaceSessionEvidence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionJti" TEXT NOT NULL,
    "ipHash" TEXT,
    "uaHash" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WorkspaceSessionEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSessionEvidence_workspaceId_sessionJti_key"
ON "WorkspaceSessionEvidence"("workspaceId", "sessionJti");
CREATE INDEX "WorkspaceSessionEvidence_workspaceId_userId_lastSeenAt_idx"
ON "WorkspaceSessionEvidence"("workspaceId", "userId", "lastSeenAt");
CREATE INDEX "WorkspaceSessionEvidence_lastSeenAt_idx"
ON "WorkspaceSessionEvidence"("lastSeenAt");

ALTER TABLE "WorkspaceSessionEvidence"
ADD CONSTRAINT "WorkspaceSessionEvidence_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSessionEvidence"
ADD CONSTRAINT "WorkspaceSessionEvidence_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Encrypted, expiring idempotency receipts for create/rotate API-key calls.
CREATE TABLE "ApiKeyMutationReceipt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKeyHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseCiphertext" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "apiKeyId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKeyMutationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKeyMutationReceipt_idempotency_key"
ON "ApiKeyMutationReceipt"("workspaceId", "actorUserId", "operation", "idempotencyKeyHash");
CREATE INDEX "ApiKeyMutationReceipt_workspaceId_expiresAt_idx"
ON "ApiKeyMutationReceipt"("workspaceId", "expiresAt");
CREATE INDEX "ApiKeyMutationReceipt_expiresAt_idx"
ON "ApiKeyMutationReceipt"("expiresAt");

ALTER TABLE "ApiKeyMutationReceipt"
ADD CONSTRAINT "ApiKeyMutationReceipt_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sanitized control-plane evidence for security SLO evaluation.
CREATE TABLE "SecurityControlEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "workspaceId" TEXT,
    "actorHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityControlEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityControlEvent_eventType_createdAt_idx" ON "SecurityControlEvent"("eventType", "createdAt");
CREATE INDEX "SecurityControlEvent_scope_createdAt_idx" ON "SecurityControlEvent"("scope", "createdAt");
CREATE INDEX "SecurityControlEvent_workspaceId_createdAt_idx" ON "SecurityControlEvent"("workspaceId", "createdAt");
CREATE INDEX "SecurityControlEvent_createdAt_idx" ON "SecurityControlEvent"("createdAt");
