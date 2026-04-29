-- Migration: PostgreSQL advisory locking for Meta Ads sync
-- Implements the three-layer safety model:
--   1. advisory_lock_key() SQL function for short ownership transactions
--   2. SyncLock table for persistent lease + fencing token
--   3. CampaignMetric unique key upgrade for fenced idempotent upserts

-- ── 1. PostgreSQL advisory lock helper function ────────────────────────────
-- Converts a text scope into a deterministic 64-bit integer for pg_try_advisory_xact_lock.
-- IMMUTABLE so Postgres can inline/cache it.
CREATE OR REPLACE FUNCTION advisory_lock_key(scope text)
RETURNS bigint AS $$
  SELECT ('x' || substr(md5(scope), 1, 16))::bit(64)::bigint;
$$ LANGUAGE sql IMMUTABLE;

-- ── 2. SyncLock table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SyncLock" (
    "scope"          TEXT      PRIMARY KEY,
    "provider"       TEXT      NOT NULL,
    "workspaceId"    TEXT      NOT NULL,
    "connectionId"   TEXT      NOT NULL,
    "accountId"      TEXT      NOT NULL,
    "jobId"          TEXT,
    "leaseId"        TEXT      NOT NULL,
    "fencingToken"   BIGINT    NOT NULL DEFAULT 1,
    "status"         TEXT      NOT NULL DEFAULT 'running',
    "heartbeatAt"    TIMESTAMPTZ NOT NULL,
    "leaseExpiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "SyncLock_provider_workspaceId_accountId_idx"
    ON "SyncLock" ("provider", "workspaceId", "accountId");

CREATE INDEX IF NOT EXISTS "SyncLock_leaseExpiresAt_idx"
    ON "SyncLock" ("leaseExpiresAt");

CREATE INDEX IF NOT EXISTS "SyncLock_jobId_idx"
    ON "SyncLock" ("jobId");

-- ── 3. CampaignMetric — add new columns ───────────────────────────────────
-- level and breakdownHash were added in the previous migration; skip if present.
ALTER TABLE "CampaignMetric"
    ADD COLUMN IF NOT EXISTS "entityId"      TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "campaignName"  TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "adId"          TEXT             DEFAULT '',
    ADD COLUMN IF NOT EXISTS "syncJobId"     TEXT,
    ADD COLUMN IF NOT EXISTS "lockScope"     TEXT,
    ADD COLUMN IF NOT EXISTS "fencingToken"  BIGINT;

-- Backfill entityId from campaignId for existing rows so the new unique key is satisfiable.
UPDATE "CampaignMetric"
SET "entityId" = COALESCE(NULLIF("campaignId", ''), id)
WHERE "entityId" = '';

-- Ensure breakdownHash defaults to 'none' for pre-existing rows (prev migration used '').
UPDATE "CampaignMetric"
SET "breakdownHash" = 'none'
WHERE "breakdownHash" = '' OR "breakdownHash" IS NULL;

-- ── 4. Replace old unique index with new composite idempotency key ─────────
-- Drop previous unique indexes created in the 20260430 migration.
DROP INDEX IF EXISTS "CampaignMetric_connectionId_accountId_date_level_campaignId_breakdownHash_key";
DROP INDEX IF EXISTS "CampaignMetric_connectionId_campaignId_date_key";

-- Deduplicate: keep the most-recently-pulled row per new composite key.
DELETE FROM "CampaignMetric"
WHERE id NOT IN (
    SELECT DISTINCT ON ("connectionId", "accountId", "level", "entityId", "date", "breakdownHash") id
    FROM "CampaignMetric"
    ORDER BY "connectionId", "accountId", "level", "entityId", "date", "breakdownHash", "pulledAt" DESC
);

-- Create the definitive idempotency unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignMetric_connectionId_accountId_level_entityId_date_breakdownHash_key"
    ON "CampaignMetric" ("connectionId", "accountId", "level", "entityId", "date", "breakdownHash");
