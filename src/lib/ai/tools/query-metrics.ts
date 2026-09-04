import { queryMetricsAggregate } from "@/lib/warehouse-aggregate";
import { sanitizeToolResult } from "@/lib/ai/sanitize";
import type { AiTool, AiToolContext, AiToolResult } from "./types";

export const queryMetricsTool: AiTool = {
  name: "query_metrics",
  description: "Aggregate allowlisted CampaignMetric fields for this workspace only.",
  async execute(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
    const workspaceId = ctx.workspaceId;
    if (typeof args.workspaceId === "string" && args.workspaceId !== workspaceId) {
      throw new Error("tenant mismatch");
    }
    const startDateStr = typeof args.startDate === "string" ? args.startDate : "";
    const endDateStr = typeof args.endDate === "string" ? args.endDate : "";
    if (!startDateStr || !endDateStr) {
      return { ok: false, evidenceRefs: [], error: { code: "bad_args", message: "startDate and endDate required" } };
    }
    const result = await queryMetricsAggregate({
      workspaceId,
      clientId: ctx.clientId,
      startDateStr,
      endDateStr,
      platform: typeof args.platform === "string" ? args.platform : null,
      campaignId: typeof args.campaignId === "string" ? args.campaignId : null,
      dimensions: Array.isArray(args.dimensions) ? args.dimensions.map(String) : undefined,
      metrics: Array.isArray(args.metrics) ? args.metrics.map(String) : undefined,
    });
    return {
      ok: true,
      data: sanitizeToolResult(result),
      evidenceRefs: [{ querySpec: { startDateStr, endDateStr, platform: args.platform } }],
    };
  },
};
