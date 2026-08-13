import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveApiKey } from "@/lib/api-key-security";
import { logger } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authorization = req.headers.get("authorization") ?? "";
    const secret = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const key = await resolveApiKey(secret);
    if (!key) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const job = await prisma.lookerJob.findFirst({
      where: { id, workspaceId: key.workspaceId, apiKeyId: key.id },
      select: {
        id: true,
        status: true,
        rowCount: true,
        resultUrl: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(job);
  } catch (error) {
    logger.error("Looker job status error", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
