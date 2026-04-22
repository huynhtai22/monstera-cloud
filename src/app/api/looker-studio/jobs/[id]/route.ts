import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import prisma from "@/lib/prisma";

const UPSTASH_AVAILABLE = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = UPSTASH_AVAILABLE ? Redis.fromEnv() : null;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params;
    const job = await prisma.lookerJob.findUnique({ where: { id: jobId } });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(job);
  } catch (e) {
    console.error("Jobs GET error", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
