-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATING', 'PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "orderCode" BIGINT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "plan" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "accessDurationDays" INTEGER NOT NULL DEFAULT 30,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATING',
    "paymentLinkId" TEXT,
    "checkoutUrl" TEXT,
    "qrCode" TEXT,
    "transactionRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_orderCode_key" ON "PaymentOrder"("orderCode");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_paymentLinkId_key" ON "PaymentOrder"("paymentLinkId");

-- CreateIndex
CREATE INDEX "PaymentOrder_workspaceId_status_idx" ON "PaymentOrder"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "PaymentOrder_orderCode_idx" ON "PaymentOrder"("orderCode");

-- CreateIndex
CREATE INDEX "PaymentOrder_expiresAt_idx" ON "PaymentOrder"("expiresAt");

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
