-- Additive: append-only store for Connector Runtime v1 gate verdict artifacts.
-- No existing tables are altered; no data is backfilled or reinterpreted.
CREATE TABLE "ConnectorRunArtifact" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "retainedUntil" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorRunArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConnectorRunArtifact_runId_kind_key" ON "ConnectorRunArtifact"("runId", "kind");
CREATE INDEX "ConnectorRunArtifact_workspaceId_connectionId_idx" ON "ConnectorRunArtifact"("workspaceId", "connectionId");
ALTER TABLE "ConnectorRunArtifact" ADD CONSTRAINT "ConnectorRunArtifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
