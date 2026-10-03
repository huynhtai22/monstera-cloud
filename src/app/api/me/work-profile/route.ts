import prisma from "@/lib/prisma";
import { saveWorkProfile } from "@/lib/agent/runs";
import { agentErrorResponse, agentJson, agentUserId } from "@/lib/agent/http";

export async function GET() {
  try {
    const userId = await agentUserId();
    const profile = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { workCategory: true, workContext: true, workProfileAnsweredAt: true } });
    return Response.json(profile, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return agentErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const userId = await agentUserId();
    return Response.json(await saveWorkProfile(userId, await agentJson(request)));
  } catch (error) { return agentErrorResponse(error); }
}
