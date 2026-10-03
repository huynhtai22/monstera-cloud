import { queryMetricsTool } from "./query-metrics";
import { deriveReportingReadiness } from "@/lib/reporting-readiness";
import { sanitizeToolResult } from "@/lib/ai/sanitize";
import prisma from "@/lib/prisma";
import { resolveSourceHealthState, SOURCE_HEALTH_STALE_AFTER_MS } from "@/lib/source-health";
import type { AiTool, AiToolContext, AiToolResult } from "./types";

const getReportingReadinessTool: AiTool = {
  name: "get_reporting_readiness",
  description: "Derived readiness DTO for the workspace window. Hard gate for conclusions.",
  async execute(ctx, args): Promise<AiToolResult> {
    const data = await deriveReportingReadiness(ctx.workspaceId, {
      since: typeof args.since === "string" ? args.since : undefined,
      until: typeof args.until === "string" ? args.until : undefined,
      clientId: ctx.clientId,
    });
    return { ok: true, data: sanitizeToolResult(data), evidenceRefs: [] };
  },
};

const getSourceHealthTool: AiTool = {
  name: "get_source_health",
  description: "Per-connection health and lastDataThrough for this workspace.",
  async execute(ctx: AiToolContext): Promise<AiToolResult> {
    const staleBefore = new Date(Date.now() - SOURCE_HEALTH_STALE_AFTER_MS);
    const connections = await prisma.connection.findMany({
      where: { workspaceId: ctx.workspaceId, type: "source", ...(ctx.clientId ? { clientId: ctx.clientId } : {}) },
      select: {
        id: true,
        provider: true,
        status: true,
        lastError: true,
        lastSyncAt: true,
        lastDataThrough: true,
      },
    });
    const data = connections.map((connection) => ({
      connectionId: connection.id,
      provider: connection.provider,
      health: resolveSourceHealthState({
        connectionStatus: connection.status,
        lastError: connection.lastError,
        lastSyncAt: connection.lastSyncAt,
        staleBefore,
      }),
      lastDataThrough: connection.lastDataThrough?.toISOString() ?? null,
      lastError: connection.lastError,
    }));
    return { ok: true, data: sanitizeToolResult(data), evidenceRefs: data.map((row) => ({ connectionId: row.connectionId })) };
  },
};

export const AI_TOOLS: AiTool[] = [getReportingReadinessTool, getSourceHealthTool, queryMetricsTool];

export function getAiTool(name: string): AiTool | undefined {
  return AI_TOOLS.find((tool) => tool.name === name);
}
