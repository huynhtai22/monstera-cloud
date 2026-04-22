import { Redis } from "@upstash/redis";
import prisma from "@/lib/prisma";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const UPSTASH_AVAILABLE = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
if (!UPSTASH_AVAILABLE) {
  console.error("UPSTASH env not configured. Exiting.");
  process.exit(1);
}

const redis = Redis.fromEnv();

const s3Bucket = process.env.S3_BUCKET;
if (!s3Bucket) {
  console.error("S3_BUCKET env not set. Exiting.");
  process.exit(1);
}
const s3 = new S3Client({ region: process.env.AWS_REGION });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processJob(jobId: string) {
  const job = await prisma.lookerJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  try {
    await prisma.lookerJob.update({ where: { id: jobId }, data: { status: "running", startedAt: new Date() } });

    // Build query from job.params
    const p = (job.params || {}) as Record<string, any>;
    const where: any = { workspaceId: job.workspaceId };
    if (p.platform) where.platform = p.platform;
    if (p.accountIds && Array.isArray(p.accountIds) && p.accountIds.length) where.accountId = { in: p.accountIds };
    if (p.startDate || p.endDate) {
      where.date = {};
      if (p.startDate) where.date.gte = new Date(p.startDate);
      if (p.endDate) where.date.lte = new Date(p.endDate);
    }

    const pageSize = p.pageSize && Number(p.pageSize) > 0 ? Math.min(50000, Number(p.pageSize)) : 10000;
    let cursor = undefined;
    const results: any[] = [];

    while (true) {
      const items = await prisma.campaignMetric.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: pageSize + 1,
      });
      if (items.length === 0) break;

      // push all but extra
      const take = Math.min(pageSize, items.length);
      for (let i = 0; i < take; i++) {
        const m = items[i];
        results.push({
          date: m.date.toISOString().split("T")[0].replace(/-/g, ""),
          platform: m.platform,
          accountId: m.accountId,
          accountName: m.accountName || "Unknown",
          campaignId: m.campaignId,
          campaignName: m.campaignName,
          adsetId: m.adsetId,
          adsetName: m.adsetName,
          impressions: m.impressions,
          clicks: m.clicks,
          spend: m.spend,
          reach: m.reach ?? 0,
          conversions: m.conversions ?? 0,
          revenue: m.revenue ?? 0,
          currency: m.currency,
        });
      }

      // if fewer than requested or no extra, break
      if (items.length <= pageSize) break;

      // prepare for next page using last item as cursor
      const last = items[items.length - 1];
      // reduce where to paginate by date/id
      where.AND = [
        where,
        {
          OR: [
            { date: { lt: last.date } },
            { AND: [{ date: last.date }, { id: { lt: last.id } }] },
          ],
        },
      ];
    }

    // Upload results to S3
    const body = JSON.stringify({ rows: results });
    const key = `looker/results/${jobId}.json`;
    await s3.send(new PutObjectCommand({ Bucket: s3Bucket, Key: key, Body: body, ContentType: "application/json" }));

    // Generate presigned URL (valid 7 days)
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: s3Bucket, Key: key }), { expiresIn: 60 * 60 * 24 * 7 });

    await prisma.lookerJob.update({ where: { id: jobId }, data: { status: "done", finishedAt: new Date(), resultKey: key, resultUrl: url, rowCount: results.length } });
  } catch (e: any) {
    console.error("Job processing failed", jobId, e);
    await prisma.lookerJob.update({ where: { id: jobId }, data: { status: "failed", errorMsg: String(e.message || e), finishedAt: new Date() } });
  }
}

async function main() {
  console.log("Starting Looker job worker");
  while (true) {
    try {
      const id = await redis.lpop("looker:jobs:queue");
      if (!id) {
        await sleep(2000);
        continue;
      }
      console.log("Picked job", id);
      await processJob(id as string);
    } catch (e) {
      console.error("Worker loop error", e);
      await sleep(3000);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
