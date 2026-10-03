import type { EvidenceCitation } from "@/lib/ai/evidence-pack";

export type AiToolContext = {
  workspaceId: string;
  clientId?: string;
  actorUserId?: string;
  jobId: string;
  role: "interactive" | "cron";
};

export type AiToolResult = {
  ok: boolean;
  data?: unknown;
  evidenceRefs: EvidenceCitation[];
  error?: { code: string; message: string };
};

export interface AiTool {
  name: string;
  description: string;
  execute(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult>;
}
