-- Migration: production hardening — CampaignMetric idempotency key
-- Adds level + breakdownHash columns and replaces the (connectionId, campaignId, date)
-- unique constraint with the full composite idempotency key.

-- Step 1: add new columns with safe defaults so existing rows are valid
ALTER TABLE "CampaignMetric" ADD COLUMN IF NOT EXISTS "level" TEXT NOT NULL DEFAULT 'campaign';
ALTER TABLE "CampaignMetric" ADD COLUMN IF NOT EXISTS "breakdownHash" TEXT NOT NULL DEFAULT '';

-- Step 2: drop the old narrow unique index
DROP INDEX IF EXISTS "CampaignMetric_connectionId_campaignId_date_key";

-- Step 3: deduplicate any existing rows that would violate the new constraint.
-- Keep the most recently pulled row per composite key; discard older duplicates.
DELETE FROM "CampaignMetric"
WHERE id NOT IN (
    SELECT DISTINCT ON ("connectionId", "accountId", "date", "level", "campaignId", "breakdownHash") id
    FROM "CampaignMetric"
    ORDER BY "connectionId", "accountId", "date", "level", "campaignId", "breakdownHash", "pulledAt" DESC
);

-- Step 4: create the new composite unique index
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignMetric_connectionId_accountId_date_level_campaignId_breakdownHash_key"
    ON "CampaignMetric" ("connectionId", "accountId", "date", "level", "campaignId", "breakdownHash");
