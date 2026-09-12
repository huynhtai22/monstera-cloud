-- AlterTable
ALTER TABLE "ReportSchedule" ADD COLUMN     "dispatchLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "dispatchLeaseToken" TEXT;
