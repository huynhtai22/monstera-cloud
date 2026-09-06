-- AlterTable
ALTER TABLE "Client" ADD COLUMN "accountAssignmentsConfiguredAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Connection_workspaceId_id_provider_key" ON "Connection"("workspaceId", "id", "provider");

-- CreateTable
CREATE TABLE "ClientProviderAccountAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProviderAccountAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientProviderAccountAssignment_ws_prov_acc_key" ON "ClientProviderAccountAssignment"("workspaceId", "provider", "accountId");

-- CreateIndex
CREATE INDEX "ClientProviderAccountAssignment_ws_client_idx" ON "ClientProviderAccountAssignment"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "ClientProviderAccountAssignment_ws_conn_idx" ON "ClientProviderAccountAssignment"("workspaceId", "connectionId");

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_connectionId_p_fkey" FOREIGN KEY ("workspaceId", "connectionId", "provider") REFERENCES "Connection"("workspaceId", "id", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill provably unambiguous leaf accounts from existing single-tenant CampaignMetric data
-- Only backfill where:
-- 1. Connection has clientId configured
-- 2. Within the workspace, that (platform, accountId) appears under exactly ONE connection
-- 3. All appearances map to the SAME clientId
INSERT INTO "ClientProviderAccountAssignment" ("id", "workspaceId", "clientId", "provider", "accountId", "connectionId", "assignedAt", "createdAt", "updatedAt")
SELECT
    'cpaa_' || md5(m."workspaceId" || ':' || m."platform" || ':' || m."accountId"),
    m."workspaceId",
    c."clientId",
    m."platform",
    m."accountId",
    m."connectionId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "CampaignMetric" m
JOIN "Connection" c ON c."id" = m."connectionId" AND c."workspaceId" = m."workspaceId"
WHERE c."clientId" IS NOT NULL
  AND m."accountId" IS NOT NULL
  AND m."accountId" <> ''
GROUP BY m."workspaceId", c."clientId", m."platform", m."accountId", m."connectionId"
HAVING (
    SELECT COUNT(DISTINCT m2."connectionId")
    FROM "CampaignMetric" m2
    WHERE m2."workspaceId" = m."workspaceId"
      AND m2."platform" = m."platform"
      AND m2."accountId" = m."accountId"
) = 1
AND (
    SELECT COUNT(DISTINCT c2."clientId")
    FROM "CampaignMetric" m3
    JOIN "Connection" c2 ON c2."id" = m3."connectionId" AND c2."workspaceId" = m3."workspaceId"
    WHERE m3."workspaceId" = m."workspaceId"
      AND m3."platform" = m."platform"
      AND m3."accountId" = m."accountId"
      AND c2."clientId" IS NOT NULL
) = 1
ON CONFLICT ("workspaceId", "provider", "accountId") DO NOTHING;

-- Backfill unambiguous single-account connectors (excluding multi-account providers like google_ads and meta_ads)
-- Never treat google_ads MCC or meta_ads BM root container IDs as leaf accounts!
INSERT INTO "ClientProviderAccountAssignment" ("id", "workspaceId", "clientId", "provider", "accountId", "connectionId", "assignedAt", "createdAt", "updatedAt")
SELECT
    'cpaa_' || md5(c."id" || ':' || c."provider" || ':' || c."remoteAccountId"),
    c."workspaceId",
    c."clientId",
    c."provider",
    c."remoteAccountId",
    c."id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Connection" c
WHERE c."clientId" IS NOT NULL
  AND c."remoteAccountId" IS NOT NULL
  AND c."remoteAccountId" <> ''
  AND c."provider" NOT IN ('google_ads', 'meta_ads')
GROUP BY c."workspaceId", c."clientId", c."provider", c."remoteAccountId", c."id"
HAVING (
    SELECT COUNT(DISTINCT c2."id")
    FROM "Connection" c2
    WHERE c2."workspaceId" = c."workspaceId"
      AND c2."provider" = c."provider"
      AND c2."remoteAccountId" = c."remoteAccountId"
) = 1
AND (
    SELECT COUNT(DISTINCT c3."clientId")
    FROM "Connection" c3
    WHERE c3."workspaceId" = c."workspaceId"
      AND c3."provider" = c."provider"
      AND c3."remoteAccountId" = c."remoteAccountId"
      AND c3."clientId" IS NOT NULL
) = 1
ON CONFLICT ("workspaceId", "provider", "accountId") DO NOTHING;
