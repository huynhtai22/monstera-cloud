-- P1 seat-sharing hardening: revocable browser sessions.
-- Additive only. Identity tables stay outside the tenant guard.
-- P2 API-key attribution: creator + optional office-IP pin.

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "ipHash" TEXT,
    "uaHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_jti_key" ON "UserSession"("jti");
CREATE INDEX "UserSession_userId_lastSeenAt_idx" ON "UserSession"("userId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "createdByUserId" TEXT,
ADD COLUMN "allowedIpHash" TEXT;
