import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import prisma from "@/lib/prisma";
import { v4 as uuidv4 } from "uuid";

const UPSTASH_AVAILABLE = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = UPSTASH_AVAILABLE ? Redis.fromEnv() : null;

async function resolveWorkspaceFromRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const apiKey = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : req.nextUrl.searchParams.get("apiKey")?.trim() ?? null;
  if (!apiKey) return null;
  // Basic API key auth only for jobs (Google JWT not supported here)
  const keyRecord = await prisma.apiKey.findUnique({ where: { key: apiKey } });
  if (!keyRecord) return null;
  return { workspaceId: keyRecord.workspaceId, apiKeyId: keyRecord.id };
}

export async function POST(req: NextRequest) {
  try {
    const resolved = await resolveWorkspaceFromRequest(req);
    if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { workspaceId, apiKeyId } = resolved as { workspaceId: string; apiKeyId: string };

    if (!redis) return NextResponse.json({ error: "Job queue unavailable" }, { status: 503 });

    const body = await req.json();
    const jobId = uuidv4();

    // Persist job metadata in DB
    await prisma.lookerJob.create({
      data: {
        id: jobId,
        workspaceId,
        apiKeyId,
        params: body.params || {},
        status: "queued",
      },
    });

    // Push job id to Redis queue for workers
    await redis.lpush("looker:jobs:queue", jobId);

    return NextResponse.json({ jobId });
  } catch (e) {
    console.error("Jobs POST error", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
