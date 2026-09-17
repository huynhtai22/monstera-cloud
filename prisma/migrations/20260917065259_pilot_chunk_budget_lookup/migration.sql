-- CreateIndex
CREATE INDEX "WarehouseBackfillChunk_workspaceId_provider_completedAt_idx" ON "WarehouseBackfillChunk"("workspaceId", "provider", "completedAt");
