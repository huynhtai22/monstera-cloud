-- Flexible access policy: privacy-safe device labels, a 24-hour overflow
-- allowance, and durable revocation explanations. Additive and nullable so
-- existing sessions remain valid without backfill.

ALTER TABLE "UserSession"
ADD COLUMN "deviceLabel" TEXT,
ADD COLUMN "graceEndsAt" TIMESTAMP(3),
ADD COLUMN "revokedReason" TEXT;
