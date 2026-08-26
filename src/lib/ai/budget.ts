import prisma from "@/lib/prisma";
import { emitMonitor } from "@/lib/observability/monitors";

export const DEFAULT_MONTHLY_USD = 25;
export const DEFAULT_MONTHLY_TOKENS = 2_000_000;

export type BudgetState = {
  usdUsed: number;
  usdLimit: number;
  tokensUsed: number;
  tokenLimit: number;
  remainingUsd: number;
  atOrOverLimit: boolean;
  atWarning: boolean;
};

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function getOrCreateAiPolicy(workspaceId: string) {
  return prisma.workspaceAiPolicy.upsert({
    where: { workspaceId },
    create: { workspaceId, enabledFeatures: [] },
    update: {},
  });
}

export async function getMonthlyAiBudget(workspaceId: string, now = new Date()): Promise<BudgetState> {
  const policy = await getOrCreateAiPolicy(workspaceId);
  const since = monthStart(now);
  const agg = await prisma.agentJob.aggregate({
    where: { workspaceId, createdAt: { gte: since } },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
  });
  const usdUsed = Number(agg._sum.costUsd ?? 0);
  const tokensUsed = Number(agg._sum.inputTokens ?? 0) + Number(agg._sum.outputTokens ?? 0);
  const usdLimit = policy.monthlyUsdBudget;
  const tokenLimit = policy.monthlyTokenBudget;
  const atOrOverLimit = usdUsed >= usdLimit || tokensUsed >= tokenLimit;
  const atWarning = !atOrOverLimit && (usdUsed >= usdLimit * 0.8 || tokensUsed >= tokenLimit * 0.8);
  if (atWarning) {
    emitMonitor("ai_budget_warning", { workspaceId, usdUsed, usdLimit, tokensUsed, tokenLimit });
  }
  return {
    usdUsed,
    usdLimit,
    tokensUsed,
    tokenLimit,
    remainingUsd: Math.max(0, usdLimit - usdUsed),
    atOrOverLimit,
    atWarning,
  };
}
