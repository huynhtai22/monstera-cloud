-- Migration: Connection Identity Deduplication
-- Adds remoteAccountId, deduplicates existing connections, enforces uniqueness.
-- Strategy: Keep only the most recent connection per (workspaceId, provider).
-- All other duplicates get a synthetic remoteAccountId to satisfy the unique constraint.

-- 1. Add remoteAccountId column
ALTER TABLE "Connection" ADD COLUMN IF NOT EXISTS "remoteAccountId" TEXT DEFAULT '';

-- 2. For each (workspaceId, provider) group, rank by updatedAt DESC.
--    The most recent gets remoteAccountId = name (or provider fallback).
--    Older duplicates get a synthetic suffix so @@unique never conflicts.
WITH ranked AS (
  SELECT
    id,
    "workspaceId",
    provider,
    name,
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceId", provider
      ORDER BY "updatedAt" DESC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY "workspaceId", provider) AS total
  FROM "Connection"
)
UPDATE "Connection"
SET "remoteAccountId" = CASE
  WHEN ranked.rn = 1 THEN COALESCE(ranked.name, ranked.provider, ranked.id)
  ELSE COALESCE(ranked.name, ranked.provider, ranked.id) || '::legacy-' || (ranked.total - ranked.rn + 1)::text
END
FROM ranked
WHERE "Connection".id = ranked.id;

-- 3. Add composite unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "Connection_workspaceId_provider_remoteAccountId_key"
ON "Connection"("workspaceId", provider, "remoteAccountId");
