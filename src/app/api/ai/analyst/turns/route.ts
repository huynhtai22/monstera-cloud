import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { productionRouteDisabled } from "@/lib/request-auth";
import { getMonthlyAiBudget } from "@/lib/ai/budget";
import { runAnalystTurn } from "@/lib/ai/analyst";
import { enqueueAgentJob } from "@/lib/ai/jobs";

export async function GET(req: Request) {
  if (productionRouteDisabled("ENABLE_GOVERNED_ANALYST")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = new URL(req.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "read_analyst_turns",
    });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const turns = await prisma.agentJob.findMany({
    where: { workspaceId, type: "analyst_turn" },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, status: true, result: true, refusalCode: true, createdAt: true },
  });
  return NextResponse.json({ turns });
}

export async function POST(req: Request) {
  if (productionRouteDisabled("ENABLE_GOVERNED_ANALYST")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const question = typeof body.question === "string" ? body.question : "";
  const clientId = typeof body.clientId === "string" ? body.clientId : undefined;
  const acknowledgeBestEffort = body.acknowledgeBestEffort === true;
  if (!workspaceId || !question.trim()) {
    return NextResponse.json({ error: "workspaceId and question are required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "member",
      operation: "run_analyst_turn",
    });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const budget = await getMonthlyAiBudget(workspaceId);
  if (budget.atOrOverLimit) {
    return NextResponse.json(
      { error: "AI budget exceeded", usdUsed: budget.usdUsed, usdLimit: budget.usdLimit },
      { status: 402 },
    );
  }

  const turn = await runAnalystTurn({
    workspaceId,
    actorUserId: session.user.id,
    question,
    clientId,
    acknowledgeBestEffort,
  });

  const job = await enqueueAgentJob({
    workspaceId,
    userId: session.user.id,
    type: "analyst_turn",
    payload: { question, clientId, acknowledgeBestEffort },
    status: turn.status === "queued" ? "queued" : "completed",
    result: {
      status: turn.status,
      answer: turn.answer,
      blockers: turn.blockers,
      evidence: turn.evidence,
      queuedCopy: turn.queuedCopy,
    },
    refusalCode: turn.refusalCode,
  });

  return NextResponse.json({
    turnId: job.id,
    status: turn.status,
    answer: turn.answer,
    evidence: turn.evidence,
    blockers: turn.blockers,
    queuedCopy: turn.queuedCopy,
  });
}
