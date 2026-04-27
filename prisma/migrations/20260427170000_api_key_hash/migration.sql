-- Add hashed key storage and prefix display for API keys
ALTER TABLE "ApiKey" ADD COLUMN "keyHash" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "keyPrefix" TEXT;

-- Unique index for fast hash lookups (nullable-safe via partial index not supported in all PG versions, so just unique)
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
