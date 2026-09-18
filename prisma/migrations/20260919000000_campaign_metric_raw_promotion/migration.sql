-- Promote production fields currently trapped inside CampaignMetric.rawData to
-- typed nullable columns (dual-write / dual-read foundation).
-- Additive only: no defaults, no NOT NULL, no backfill, no index, no rewrite.
-- Historical rows keep NULL and render through the legacy rawData fallback.
ALTER TABLE "CampaignMetric" ADD COLUMN "adName" TEXT;
ALTER TABLE "CampaignMetric" ADD COLUMN "shopeeBroadOrders" DOUBLE PRECISION;
ALTER TABLE "CampaignMetric" ADD COLUMN "shopeeBroadUnits" DOUBLE PRECISION;
ALTER TABLE "CampaignMetric" ADD COLUMN "shopeeBroadGmv" DOUBLE PRECISION;
ALTER TABLE "CampaignMetric" ADD COLUMN "shopeeDirectOrders" DOUBLE PRECISION;
ALTER TABLE "CampaignMetric" ADD COLUMN "shopeeDirectUnits" DOUBLE PRECISION;
ALTER TABLE "CampaignMetric" ADD COLUMN "shopeeDirectGmv" DOUBLE PRECISION;
ALTER TABLE "CampaignMetric" ADD COLUMN "shopeeKeywordSettingsCount" INTEGER;
