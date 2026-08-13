-- Agency pilot tenancy and security foundation.
-- Safe for existing installations: new workspace entitlements are backfilled from owners,
-- and existing plaintext API keys are hashed before the application stops reading them.

DO $$ BEGIN CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'member', 'viewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PlatformRole" AS ENUM ('USER', 'OPERATOR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WorkspaceStatus" AS ENUM ('PILOT', 'ACTIVE', 'SUSPENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "otpLockedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';

ALTER TABLE "WorkspaceMember" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "WorkspaceMember"
  ALTER COLUMN "role" TYPE "WorkspaceRole"
  USING CASE
    WHEN "role" = 'owner' THEN 'owner'::"WorkspaceRole"
    WHEN "role" = 'admin' THEN 'admin'::"WorkspaceRole"
    WHEN "role" = 'member' THEN 'member'::"WorkspaceRole"
    ELSE 'viewer'::"WorkspaceRole"
  END;
ALTER TABLE "WorkspaceMember" ALTER COLUMN "role" SET DEFAULT 'member';

ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'pilot',
  ADD COLUMN IF NOT EXISTS "status" "WorkspaceStatus" NOT NULL DEFAULT 'PILOT',
  ADD COLUMN IF NOT EXISTS "subscriptionProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT;

UPDATE "Workspace" AS workspace
SET "plan" = COALESCE(NULLIF(owner_user."plan", ''), 'pilot')
FROM "User" AS owner_user
WHERE owner_user.id = workspace."ownerId";

CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_subscriptionId_key" ON "Workspace"("subscriptionId");

-- Some legacy production databases predate the asynchronous Looker job table.
-- Reconcile it here before the baseline is adopted; the pilot keeps job creation disabled,
-- but retaining the table makes the schema complete and polling safe.
CREATE TABLE IF NOT EXISTS "LookerJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "params" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "resultKey" TEXT,
  "resultUrl" TEXT,
  "rowCount" INTEGER,
  "errorMsg" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "LookerJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LookerJob_workspaceId_status_idx"
  ON "LookerJob"("workspaceId", "status");
DO $$ BEGIN
  ALTER TABLE "LookerJob" ADD CONSTRAINT "LookerJob_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "WorkspaceProviderAccess" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceProviderAccess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceProviderAccess_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceProviderAccess_workspaceId_provider_key"
  ON "WorkspaceProviderAccess"("workspaceId", "provider");
CREATE INDEX IF NOT EXISTS "WorkspaceProviderAccess_workspaceId_enabled_idx"
  ON "WorkspaceProviderAccess"("workspaceId", "enabled");

INSERT INTO "WorkspaceProviderAccess" ("id", "workspaceId", "provider", "enabledAt", "updatedAt")
SELECT 'provider_' || md5(workspace.id || provider.name), workspace.id, provider.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
CROSS JOIN (VALUES ('meta_ads'), ('google_ads'), ('tiktok_business'), ('shopee')) AS provider(name)
ON CONFLICT ("workspaceId", "provider") DO NOTHING;

CREATE TABLE IF NOT EXISTS "WorkspaceInvitation" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'member',
  "workspaceId" TEXT,
  "agencyName" TEXT,
  "agencySlug" TEXT,
  "plan" TEXT,
    "enabledProviders" TEXT[] NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceInvitation_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");
CREATE INDEX IF NOT EXISTS "WorkspaceInvitation_email_expiresAt_idx" ON "WorkspaceInvitation"("email", "expiresAt");
CREATE INDEX IF NOT EXISTS "WorkspaceInvitation_workspaceId_acceptedAt_idx" ON "WorkspaceInvitation"("workspaceId", "acceptedAt");

CREATE TABLE IF NOT EXISTS "OAuthAttempt" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "reconnectConnectionId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthAttempt_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAttempt_tokenHash_key" ON "OAuthAttempt"("tokenHash");
CREATE INDEX IF NOT EXISTS "OAuthAttempt_userId_provider_expiresAt_idx" ON "OAuthAttempt"("userId", "provider", "expiresAt");
CREATE INDEX IF NOT EXISTS "OAuthAttempt_workspaceId_consumedAt_idx" ON "OAuthAttempt"("workspaceId", "consumedAt");

CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "resourceId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditEvent_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE "ApiKey"
  ADD COLUMN IF NOT EXISTS "keyHash" TEXT,
  ADD COLUMN IF NOT EXISTS "keyPrefix" TEXT,
  ADD COLUMN IF NOT EXISTS "keyLastFour" TEXT,
  ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);

UPDATE "ApiKey"
SET "keyHash" = encode(digest("key", 'sha256'), 'hex'),
    "keyPrefix" = left("key", 8),
    "keyLastFour" = right("key", 4)
WHERE "key" IS NOT NULL;

ALTER TABLE "ApiKey" ALTER COLUMN "key" DROP NOT NULL;
UPDATE "ApiKey" SET "key" = NULL WHERE "keyHash" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
