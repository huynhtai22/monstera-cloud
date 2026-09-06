-- CreateTable
CREATE TABLE "ClientProviderAccountAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
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

-- CreateIndex
CREATE INDEX "ClientProviderAccountAssignment_ws_prov_acc_stat_idx" ON "ClientProviderAccountAssignment"("workspaceId", "provider", "accountId", "status");

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProviderAccountAssignment" ADD CONSTRAINT "ClientProviderAccountAssignment_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "Connection"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill provably unambiguous assignments from existing Connection.clientId
-- 1. Unambiguous connections with remoteAccountId
INSERT INTO "ClientProviderAccountAssignment" ("id", "workspaceId", "clientId", "provider", "accountId", "connectionId", "status", "assignedAt", "createdAt", "updatedAt")
SELECT
    'cpaa_' || md5(c."id" || ':' || c."provider" || ':' || c."remoteAccountId"),
    c."workspaceId",
    c."clientId",
    c."provider",
    c."remoteAccountId",
    c."id",
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Connection" c
WHERE c."clientId" IS NOT NULL
  AND c."remoteAccountId" IS NOT NULL
  AND c."remoteAccountId" <> ''
ON CONFLICT ("workspaceId", "provider", "accountId") DO NOTHING;

-- 2. Unambiguous CampaignMetric accounts under connections with clientId
INSERT INTO "ClientProviderAccountAssignment" ("id", "workspaceId", "clientId", "provider", "accountId", "connectionId", "status", "assignedAt", "createdAt", "updatedAt")
SELECT
    'cpaa_' || md5(m."workspaceId" || ':' || m."platform" || ':' || m."accountId"),
    m."workspaceId",
    c."clientId",
    m."platform",
    m."accountId",
    m."connectionId",
    'active',
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
ON CONFLICT ("workspaceId", "provider", "accountId") DO NOTHING;
