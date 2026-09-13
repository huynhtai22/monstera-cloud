-- Restore the six baseline tables omitted from production by the
-- 2026-08-13 baseline adoption: "DashboardTemplate", "DataQualityViolation",
-- "ReportSchedule", "SchemaVersion", "SyncLogDetail", "UserDashboard".
-- Definitions are the canonical ones from 20260401000000_baseline.
--
-- State contract (enforced below):
--   0 of 6 tables present -> create the complete canonical set.
--   6 of 6 tables present -> safe no-op (fresh canonical databases).
--   1-5 of 6 present      -> fail closed; the schema is ambiguous and must
--                            not be repaired silently.
-- No destructive statements; no data backfill; lease and dispatch-attempt
-- objects are intentionally untouched (owned by later migrations).
DO $restore$
DECLARE
  present_count integer;
BEGIN
  SELECT count(*) INTO present_count
    FROM information_schema.tables
   WHERE table_schema = current_schema()
     AND table_name IN ('DashboardTemplate', 'DataQualityViolation', 'ReportSchedule',
                        'SchemaVersion', 'SyncLogDetail', 'UserDashboard');
  IF present_count = 6 THEN
    RAISE NOTICE 'restore_missing_baseline_tables: all six baseline tables already present; nothing to do';
    RETURN;
  END IF;
  IF present_count > 0 THEN
    RAISE EXCEPTION 'restore_missing_baseline_tables: partial baseline state detected (% of 6 tables present); refusing to repair an ambiguous schema automatically', present_count
          USING HINT = 'Reconcile manually from the 20260401000000_baseline definitions before deploying.';
  END IF;

  EXECUTE $ddl$
CREATE TABLE "DashboardTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "requiredSources" TEXT[],
    "requiredMetrics" TEXT[],
    "previewImage" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardTemplate_pkey" PRIMARY KEY ("id")
)
$ddl$;

  EXECUTE $ddl$
CREATE TABLE "DataQualityViolation" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pipelineId" TEXT,
    "connectionId" TEXT,
    "expectedValue" DOUBLE PRECISION,
    "actualValue" DOUBLE PRECISION NOT NULL,
    "pctChange" DOUBLE PRECISION,
    "syncLogId" TEXT,
    "sampleData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQualityViolation_pkey" PRIMARY KEY ("id")
)
$ddl$;

  EXECUTE $ddl$
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT,
    "cron" TEXT NOT NULL DEFAULT '0 9 * * 1',
    "recipients" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
)
$ddl$;

  EXECUTE $ddl$
CREATE TABLE "SchemaVersion" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schemaHash" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "primaryKeys" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "breakingChanges" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deprecatedAt" TIMESTAMP(3),

    CONSTRAINT "SchemaVersion_pkey" PRIMARY KEY ("id")
)
$ddl$;

  EXECUTE $ddl$
CREATE TABLE "SyncLogDetail" (
    "id" TEXT NOT NULL,
    "syncLogId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "bytesTransferred" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorDetails" TEXT,
    "schemaVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLogDetail_pkey" PRIMARY KEY ("id")
)
$ddl$;

  EXECUTE $ddl$
CREATE TABLE "UserDashboard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" TEXT NOT NULL,
    "dateRange" TEXT NOT NULL DEFAULT 'last_30_days',
    "filters" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDashboard_pkey" PRIMARY KEY ("id")
);
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "ReportSchedule_workspaceId_idx" ON "ReportSchedule"("workspaceId")
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "ReportSchedule_clientId_idx" ON "ReportSchedule"("clientId")
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "DataQualityViolation_workspaceId_status_idx" ON "DataQualityViolation"("workspaceId", "status")
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "DataQualityViolation_ruleId_createdAt_idx" ON "DataQualityViolation"("ruleId", "createdAt")
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "DataQualityViolation_createdAt_idx" ON "DataQualityViolation"("createdAt")
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "SyncLogDetail_syncLogId_stage_idx" ON "SyncLogDetail"("syncLogId", "stage")
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "SyncLogDetail_createdAt_idx" ON "SyncLogDetail"("createdAt")
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "SchemaVersion_provider_discoveredAt_idx" ON "SchemaVersion"("provider", "discoveredAt")
$ddl$;

  EXECUTE $ddl$
CREATE UNIQUE INDEX "SchemaVersion_connectionId_version_key" ON "SchemaVersion"("connectionId", "version")
$ddl$;

  EXECUTE $ddl$
CREATE UNIQUE INDEX "DashboardTemplate_slug_key" ON "DashboardTemplate"("slug")
$ddl$;

  EXECUTE $ddl$
CREATE INDEX "UserDashboard_workspaceId_isDefault_idx" ON "UserDashboard"("workspaceId", "isDefault");
$ddl$;

  EXECUTE $ddl$
ALTER TABLE "DataQualityViolation" ADD CONSTRAINT "DataQualityViolation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DataQualityRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
$ddl$;

  EXECUTE $ddl$
ALTER TABLE "DataQualityViolation" ADD CONSTRAINT "DataQualityViolation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
$ddl$;

  EXECUTE $ddl$
ALTER TABLE "UserDashboard" ADD CONSTRAINT "UserDashboard_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
$ddl$;

  RAISE NOTICE 'restore_missing_baseline_tables: created the six missing baseline tables and their foreign keys';
END
$restore$;
