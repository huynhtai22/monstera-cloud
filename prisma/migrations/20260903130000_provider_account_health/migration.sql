-- CreateTable
CREATE TABLE "ProviderAccountHealth" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'healthy',
    "errorCategory" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccountHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccountHealth_connectionId_accountId_key" ON "ProviderAccountHealth"("connectionId", "accountId");

-- CreateIndex
CREATE INDEX "ProviderAccountHealth_workspaceId_provider_status_idx" ON "ProviderAccountHealth"("workspaceId", "provider", "status");

-- CreateIndex
CREATE INDEX "ProviderAccountHealth_connectionId_status_idx" ON "ProviderAccountHealth"("connectionId", "status");

-- AddForeignKey
ALTER TABLE "ProviderAccountHealth" ADD CONSTRAINT "ProviderAccountHealth_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountHealth" ADD CONSTRAINT "ProviderAccountHealth_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
