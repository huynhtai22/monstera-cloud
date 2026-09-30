import { z } from "zod";
import { VersionSchema } from "@/lib/agent/contracts";
import { setAgentRunPaused, getAgentRun, continueDeferredOnboarding } from "@/lib/agent/runs";
import { ownedRunScope } from "@/lib/agent/route-scope";
import { agentErrorResponse, agentJson, agentUserId } from "@/lib/agent/http";

const Schema = z.object({ expectedVersion: VersionSchema, action: z.enum(["pause", "resume", "finish", "continue_deferred"]) }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await agentUserId();
    const { runId } = await params;
    const scope = await ownedRunScope(userId, runId);
    const input = Schema.parse(await agentJson(request));
    if (input.action === "continue_deferred") {
      const next = await continueDeferredOnboarding(scope, runId, input.expectedVersion);
      return Response.json(await getAgentRun(scope, next.id));
    }
    if (input.action === "finish") {
      const { finishOnboardingRun } = await import("@/lib/agent/execution");
      await finishOnboardingRun(scope, runId, input.expectedVersion);
    } else {
      await setAgentRunPaused(scope, runId, input.expectedVersion, input.action === "pause");
    }
    return Response.json(await getAgentRun(scope, runId));
  } catch (error) { return agentErrorResponse(error); }
}
