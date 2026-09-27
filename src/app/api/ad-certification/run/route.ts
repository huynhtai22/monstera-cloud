import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import {
  CertificationHarness,
  CURRENT_SCHEMA_VERSION,
  EVIDENCE_PACK_SCHEMA_VERSION,
  HARNESS_VERSION,
  resolveRuntimeCommitSha,
  resolveRuntimeSchemaVersion,
  resolveWorkingTreeDirty,
} from "@/lib/ad-certification/harness";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  connectionId: z.string().trim().min(1).max(128),
  accountId: z.string().trim().min(1).max(32),
  startDate: dateOnly,
  endDate: dateOnly,
  destination: z.enum(["google_sheets", "looker_studio"]).optional(),
  nativeComparison: z.object({
    spend: z.number().finite().nonnegative(),
    impressions: z.number().finite().nonnegative(),
    clicks: z.number().finite().nonnegative(),
    conversions: z.number().finite().nonnegative(),
    revenue: z.number().finite().nonnegative(),
  }).strict().optional(),
  snapshotTiming: z.object({
    nativeRetrievalTime: z.string().datetime().optional(),
    monsteraDataThroughTime: z.string().datetime().optional(),
    warehouseQueryTime: z.string().datetime().optional(),
    attributionConfig: z.string().max(500).optional(),
    conversionEventSelection: z.string().max(500).optional(),
    campaignStatusFilter: z.string().max(500).optional(),
    reportingGranularity: z.enum(["DAILY", "TOTAL"]).optional(),
    lateArrivalLookbackDays: z.number().int().min(0).max(30).optional(),
    nativeComparisonSource: z.enum(["UI_EXPORT", "AD_MANAGER_UI", "DIRECT_API"]).optional(),
  }).strict().optional(),
  varianceExplanations: z.record(z.string(), z.string().trim().min(1).max(1000)).optional(),
}).strict();

function isValidDateOnly(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.AD_CERTIFICATION_LIVE_RUNS_ENABLED !== "true") {
    return NextResponse.json({ error: "Live certification runs are not enabled for this deployment" }, { status: 503 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, platformRole: true } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.platformRole !== "OPERATOR") {
    return NextResponse.json({ error: "Forbidden: live certification runs require platform role OPERATOR" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid live certification input", issues: parsed.error.issues }, { status: 400 });

  const input = parsed.data;
  if (!isValidDateOnly(input.startDate) || !isValidDateOnly(input.endDate)) {
    return NextResponse.json({ error: "startDate and endDate must be real calendar dates" }, { status: 400 });
  }
  const days = Math.round((Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < 1 || days > 7) return NextResponse.json({ error: "Google Ads live certification is limited to a single 7-day reporting window" }, { status: 400 });
  if (input.accountId.replace(/\D/g, "").length !== 10) {
    return NextResponse.json({ error: "accountId must be a 10-digit Google Ads customer ID" }, { status: 400 });
  }

  const commitSha = resolveRuntimeCommitSha();
  const schemaVersion = resolveRuntimeSchemaVersion();
  const workingTreeDirty = resolveWorkingTreeDirty();
  let appliedSchemaVersion: string | undefined;
  try {
    const appliedMigrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC
      LIMIT 1
    `;
    appliedSchemaVersion = appliedMigrations[0]?.migration_name;
  } catch {
    return NextResponse.json({ error: "Live certification requires verifiable database migration metadata" }, { status: 503 });
  }
  if (!/^[a-f0-9]{40}$/i.test(commitSha) || schemaVersion !== CURRENT_SCHEMA_VERSION || appliedSchemaVersion !== CURRENT_SCHEMA_VERSION || workingTreeDirty) {
    return NextResponse.json({ error: "Live certification requires a clean deployed build with matching immutable commit and schema metadata" }, { status: 409 });
  }

  const canonicalAccountId = input.accountId.replace(/\D/g, "");
  const harness = new CertificationHarness();
  try {
    const result = await harness.execute({
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      provider: "google_ads",
      accountId: canonicalAccountId,
      startDate: input.startDate,
      endDate: input.endDate,
      destination: input.destination,
      buildId: process.env.VERCEL_DEPLOYMENT_ID || commitSha,
      evidenceClass: "live_certification_evidence",
      nativeComparison: input.nativeComparison,
      snapshotTiming: input.snapshotTiming,
      varianceExplanations: input.varianceExplanations,
      trustedRuntimeMetadata: {
        commitSha,
        schemaVersion,
        workingTreeDirty,
        harnessVersion: HARNESS_VERSION,
        evidencePackSchemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
      },
    });
    const [persistedPack, runAudit] = await Promise.all([
      prisma.evidencePackRecord.findFirst({
        where: { workspaceId: input.workspaceId, jobId: result.evidencePack.runId },
        select: { id: true },
      }),
      prisma.auditEvent.findFirst({
        where: {
          workspaceId: input.workspaceId,
          action: "ad_connector_certification.run_evaluated",
          resourceId: "google_ads",
          metadata: { path: ["runId"], equals: result.evidencePack.runId },
        },
        select: { id: true },
      }),
    ]);
    if (!persistedPack || !runAudit) {
      return NextResponse.json({ error: "The certification evidence could not be durably persisted; no run result is available for review" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, evidencePack: result.evidencePack, markdownReport: result.markdownReport });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Certification evaluation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
