ALTER TABLE "Workspace" ADD COLUMN "subscriptionEndsAt" TIMESTAMP(3);
CREATE INDEX "Workspace_subscriptionProvider_subscriptionEndsAt_idx" ON "Workspace"("subscriptionProvider", "subscriptionEndsAt");
