-- Demo / product-screenshot overlays (Settings toggles)
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "demoMockMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "demoMockMeta" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "demoMockShopee" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "demoMockGoogleAds" BOOLEAN NOT NULL DEFAULT false;
