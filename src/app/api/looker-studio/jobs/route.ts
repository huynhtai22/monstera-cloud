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
  return keyRecord.workspaceId;
}

export async function POST(req: NextRequest) {
  try {
    const workspaceId = await resolveWorkspaceFromRequest(req);
    if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!redis) return NextResponse.json({ error: "Job queue unavailable" }, { status: 503 });

    const body = await req.json();
    const jobId = uuidv4();
    const job = {
      id: jobId,
      workspaceId,
      params: body.params || {},
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    await redis.set(`looker:job:${jobId}`, JSON.stringify(job), { ex: 60 * 60 * 24 * 7 });
    await redis.lpush("looker:jobs:queue", jobId);

    return NextResponse.json({ jobId });
  } catch (e) {
    console.error("Jobs POST error", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
