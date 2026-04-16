import prisma from "@/lib/prisma";
import { getPlanLimits, userSyncCron } from "@/lib/plan-config";

export type EnsurePipelineResult = {
  pipelineCreated: boolean;
  pipelineId?: string;
  /** True when workspace has no destination — user must add Sheets / Looker etc. */
  needsDestination: boolean;
  skippedReason?: "limit" | "already_exists";
};

/**
 * OAuth routes create sources via Prisma directly, so they skip POST /api/connections
 * auto-mapping. This mirrors that logic: if a destination exists, create the first pipeline.
 */
export async function ensureDefaultPipelineAfterSourceConnect(params: {
  workspaceId: string;
  sourceConnectionId: string;
  /** Used for staggered cron; prefer workspace owner. */
  actingUserId: string;
}): Promise<EnsurePipelineResult> {
  const { workspaceId, sourceConnectionId, actingUserId } = params;

  const existingForSource = await prisma.pipeline.findFirst({
    where: { sourceConnectionId },
    select: { id: true },
  });
  if (existingForSource) {
    return { pipelineCreated: false, needsDestination: false, skippedReason: "already_exists" };
  }

  const destinations = await prisma.connection.findMany({
    where: { workspaceId, type: "destination" },
    select: { id: true, name: true, provider: true },
  });
  const dest =
    destinations.find((d) => d.provider === "google_sheets") ??
    destinations.find((d) => d.provider === "looker_studio") ??
    destinations[0];

  if (!dest) {
    return { pipelineCreated: false, needsDestination: true };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  const ownerId = workspace?.ownerId ?? actingUserId;

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { plan: true },
  });
  const limits = getPlanLimits(owner?.plan ?? "free");
  const existingCount = await prisma.pipeline.count({ where: { workspaceId } });
  if (limits.maxPipelines !== Infinity && existingCount >= limits.maxPipelines) {
    return { pipelineCreated: false, needsDestination: false, skippedReason: "limit" };
  }

  const source = await prisma.connection.findUnique({
    where: { id: sourceConnectionId },
    select: { name: true },
  });

  const pipeline = await prisma.pipeline.create({
    data: {
      workspaceId,
      name: `Sync: ${source?.name ?? "Source"} → ${dest.name}`,
      sourceConnectionId,
      destinationConnectionId: dest.id,
      scheduleCron: userSyncCron(ownerId),
    },
  });

  return { pipelineCreated: true, pipelineId: pipeline.id, needsDestination: false };
}

/** Redirect target after OAuth source connect — console reads these query params once. */
export function buildConsoleOauthSuccessUrl(
  base: string,
  provider: string,
  result: EnsurePipelineResult
): URL {
  const u = new URL("/sources", base);
  u.searchParams.set("oauth_success", "1");
  u.searchParams.set("provider", provider);
  if (result.pipelineCreated) u.searchParams.set("pipeline_ready", "1");
  else if (result.needsDestination) u.searchParams.set("needs_destination", "1");
  else if (result.skippedReason === "limit") u.searchParams.set("pipeline_limit", "1");
  return u;
}
