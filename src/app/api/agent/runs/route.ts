import { createOrResumeOnboardingRun, getAgentRun } from "@/lib/agent/runs";
import { agentErrorResponse, agentJson, agentUserId } from "@/lib/agent/http";

export async function POST(request: Request) {
  try {
    const userId = await agentUserId();
    const { run, created } = await createOrResumeOnboardingRun(userId, await agentJson(request));
    const snapshot = await getAgentRun({ userId, workspaceId: run.workspaceId }, run.id);
    return Response.json({ ...snapshot, created }, { status: created ? 201 : 200 });
  } catch (error) { return agentErrorResponse(error); }
}
