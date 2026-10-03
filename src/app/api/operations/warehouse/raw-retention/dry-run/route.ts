import { z } from "zod";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import {
  MAX_RAW_RETENTION_SAMPLE_SIZE,
  measureCampaignMetricRawRetention,
  RawRetentionInputError,
  RawRetentionTimeoutError,
} from "@/lib/warehouse-raw-retention";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  retentionDays: z.enum(["14", "30", "90"]),
  platform: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
  sampleSize: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(MAX_RAW_RETENTION_SAMPLE_SIZE)).optional(),
}).strict();

type Dependencies = {
  getSession: typeof getAuthSession;
  findOperator: (userId: string) => Promise<{ id: string } | null>;
  measure: typeof measureCampaignMetricRawRetention;
};

export function createRawRetentionDryRunHandler(deps: Dependencies) {
  return async function GET(request: Request) {
  const session = await deps.getSession();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const operator = await deps.findOperator(session.user.id);
  if (!operator) return Response.json({ error: "Operator access required" }, { status: 403 });

  const url = new URL(request.url);
  for (const key of ["workspaceId", "retentionDays", "platform", "sampleSize"]) {
    if (url.searchParams.getAll(key).length > 1) {
      return Response.json({ error: "Request parameters must not be repeated." }, { status: 400 });
    }
  }
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid raw retention dry-run request." }, { status: 400 });

  try {
    const result = await deps.measure({
      workspaceId: parsed.data.workspaceId,
      retentionDays: Number(parsed.data.retentionDays) as 14 | 30 | 90,
      platform: parsed.data.platform,
      sampleSize: parsed.data.sampleSize,
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RawRetentionTimeoutError) return Response.json({ error: "Measurement timed out." }, { status: 408 });
    if (error instanceof RawRetentionInputError) return Response.json({ error: "Invalid workspace scope." }, { status: 400 });
    return Response.json({ error: "Unable to measure raw retention." }, { status: 500 });
  }
  };
}

/** Operator-only, read-only rawData retention measurement. Pruning is disabled. */
export const GET = createRawRetentionDryRunHandler({
  getSession: getAuthSession,
  findOperator: (userId) => prisma.user.findFirst({ where: { id: userId, platformRole: "OPERATOR" }, select: { id: true } }),
  measure: measureCampaignMetricRawRetention,
});
