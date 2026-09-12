-- CreateTable
CREATE TABLE "ReportScheduleDispatchAttempt" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "occurrenceDate" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerStartedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "channelOutcomes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportScheduleDispatchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportScheduleDispatchAttempt_workspaceId_idx" ON "ReportScheduleDispatchAttempt"("workspaceId");

-- CreateIndex
CREATE INDEX "ReportScheduleDispatchAttempt_scheduleId_status_idx" ON "ReportScheduleDispatchAttempt"("scheduleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReportScheduleDispatchAttempt_scheduleId_occurrenceDate_key" ON "ReportScheduleDispatchAttempt"("scheduleId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "ReportScheduleDispatchAttempt" ADD CONSTRAINT "ReportScheduleDispatchAttempt_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportScheduleDispatchAttempt" ADD CONSTRAINT "ReportScheduleDispatchAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
