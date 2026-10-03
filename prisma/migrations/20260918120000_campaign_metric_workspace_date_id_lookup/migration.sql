-- Keyset continuation for warehouse exports: exact workspace isolation and
-- (date, id) ordering. Must remain outside a transaction for PostgreSQL.
CREATE INDEX CONCURRENTLY "CampaignMetric_workspaceId_date_id_idx"
ON "CampaignMetric" ("workspaceId", "date", "id");
