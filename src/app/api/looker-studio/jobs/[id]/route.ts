import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const UPSTASH_AVAILABLE = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = UPSTASH_AVAILABLE ? Redis.fromEnv() : null;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!redis) return NextResponse.json({ error: "Job queue unavailable" }, { status: 503 });
    const jobId = params.id;
    const raw = await redis.get(`looker:job:${jobId}`);
    if (!raw) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
      const job = JSON.parse(raw as string);
      return NextResponse.json(job);
    } catch (e) {
      return NextResponse.json({ error: "Malformed job" }, { status: 500 });
    }
  } catch (e) {
    console.error("Jobs GET error", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
