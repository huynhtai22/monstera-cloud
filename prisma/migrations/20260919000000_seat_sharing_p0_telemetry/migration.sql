-- P0 seat-sharing telemetry: login events + API-key usage counters.
-- Additive only. Raw IPs / user-agents are never stored (hashed in app code).

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ipHash" TEXT,
    "uaHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastUsedIpHash" TEXT,
ADD COLUMN "lastUsedUaHash" TEXT;
