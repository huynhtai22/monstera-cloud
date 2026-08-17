import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { logger } from "@/lib/logger";
import { z } from "zod";

const BaseRuleFields = {
  workspaceId: z.string().min(1, "workspaceId is required"),
  name: z.string().min(1, "name is required").max(100),
  severity: z.enum(["warning", "critical"]),
  notifyEmail: z.boolean().optional(),
  notifyTelegram: z.boolean().optional(),
  pipelineId: z.string().optional().nullable(),
  connectionId: z.string().optional().nullable(),
};

const MetricEnum = z.enum([
  "revenue",
  "orders",
  "roas",
  "row_count",
  "spend",
  "conversions",
  "impressions",
  "clicks",
]);

const ThresholdRuleSchema = z.object({
  ...BaseRuleFields,
  ruleType: z.literal("threshold"),
  metric: MetricEnum,
  operator: z.enum(["gt", "lt", "eq"]),
  threshold: z
    .number({ message: "threshold is required for threshold rules" })
    .refine((v) => Number.isFinite(v), "threshold must be a finite number"),
  pctThreshold: z.undefined().or(z.null()).optional(),
  expectedColumns: z.array(z.string()).optional(),
});

const ComparisonRuleSchema = z.object({
  ...BaseRuleFields,
  ruleType: z.literal("comparison"),
  metric: MetricEnum,
  operator: z.enum(["drop_pct", "increase_pct"]),
  pctThreshold: z
    .number({ message: "pctThreshold is required for comparison rules" })
    .min(0.01, "pctThreshold must be at least 0.01 (1%)")
    .max(1.0, "pctThreshold cannot exceed 1.0 (100%)"),
  threshold: z.undefined().or(z.null()).optional(),
  expectedColumns: z.array(z.string()).optional(),
});

const SchemaCheckRuleSchema = z.object({
  ...BaseRuleFields,
  ruleType: z.literal("schema_check"),
  metric: MetricEnum.default("orders"),
  operator: z.literal("schema_check"),
  expectedColumns: z
    .array(z.string().min(1))
    .min(1, "expectedColumns must contain at least one column name for schema_check rules"),
  threshold: z.undefined().or(z.null()).optional(),
  pctThreshold: z.undefined().or(z.null()).optional(),
});

export const CreateRuleSchema = z.discriminatedUnion("ruleType", [
  ThresholdRuleSchema,
  ComparisonRuleSchema,
  SchemaCheckRuleSchema,
]);

const PatchRuleSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  ruleId: z.string().optional(),
  enabled: z.boolean().optional(),
  telegramChatId: z.string().optional(),
  name: z.string().min(1).max(100).optional(),
  ruleType: z.enum(["threshold", "comparison", "schema_check"]).optional(),
  metric: MetricEnum.optional(),
  operator: z.enum(["gt", "lt", "eq", "drop_pct", "increase_pct", "schema_check"]).optional(),
  threshold: z.number().optional().nullable(),
  pctThreshold: z.number().optional().nullable(),
  severity: z.enum(["warning", "critical"]).optional(),
  notifyEmail: z.boolean().optional(),
  notifyTelegram: z.boolean().optional(),
  pipelineId: z.string().optional().nullable(),
  connectionId: z.string().optional().nullable(),
  expectedColumns: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "view_data_quality_rules",
    });

    const [rules, violations, workspace] = await Promise.all([
      prisma.dataQualityRule.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.dataQualityViolation.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { telegramChatId: true },
      }),
    ]);

    return NextResponse.json({
      rules,
      violations,
      telegramChatId: workspace?.telegramChatId || "",
    });
  } catch (err: unknown) {
    const rbacRes = toRbacResponse(err);
    if (rbacRes) return rbacRes;
    const msg = err instanceof Error ? err.message : "Failed to fetch data quality settings";
    logger.error("[settings/data-quality][GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId: data.workspaceId,
      minimumRole: "admin",
      operation: "create_data_quality_rule",
    });

    const rule = await prisma.dataQualityRule.create({
      data: {
        workspaceId: data.workspaceId,
        name: data.name,
        ruleType: data.ruleType,
        metric: data.metric,
        operator: data.operator,
        threshold: data.ruleType === "threshold" ? data.threshold : null,
        pctThreshold: data.ruleType === "comparison" ? data.pctThreshold : null,
        expectedColumns: data.ruleType === "schema_check" ? data.expectedColumns : [],
        severity: data.severity,
        enabled: true,
        notifyEmail: data.notifyEmail ?? false,
        notifyTelegram: data.notifyTelegram ?? true,
        pipelineId: data.pipelineId || null,
        connectionId: data.connectionId || null,
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: unknown) {
    const rbacRes = toRbacResponse(err);
    if (rbacRes) return rbacRes;
    const msg = err instanceof Error ? err.message : "Failed to create rule";
    logger.error("[settings/data-quality][POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { workspaceId, ruleId, telegramChatId, ...patchFields } = parsed.data;

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "update_data_quality_settings",
    });

    if (telegramChatId !== undefined) {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { telegramChatId: telegramChatId.trim() || null },
      });
      return NextResponse.json({ success: true, telegramChatId });
    }

    if (ruleId) {
      // Find existing rule within caller's workspace
      const existing = await prisma.dataQualityRule.findFirst({
        where: { id: ruleId, workspaceId },
      });

      if (!existing) {
        return NextResponse.json(
          { error: "Rule not found in this workspace" },
          { status: 404 }
        );
      }

      // If updating rule properties beyond just `enabled`, validate the merged entity
      const mergedCandidate = {
        workspaceId,
        name: patchFields.name ?? existing.name,
        ruleType: patchFields.ruleType ?? existing.ruleType,
        metric: patchFields.metric ?? existing.metric,
        operator: patchFields.operator ?? existing.operator,
        threshold: patchFields.threshold !== undefined ? patchFields.threshold : existing.threshold,
        pctThreshold: patchFields.pctThreshold !== undefined ? patchFields.pctThreshold : existing.pctThreshold,
        expectedColumns: patchFields.expectedColumns ?? existing.expectedColumns,
        severity: patchFields.severity ?? existing.severity,
        notifyEmail: patchFields.notifyEmail ?? existing.notifyEmail,
        notifyTelegram: patchFields.notifyTelegram ?? existing.notifyTelegram,
        pipelineId: patchFields.pipelineId !== undefined ? patchFields.pipelineId : existing.pipelineId,
        connectionId: patchFields.connectionId !== undefined ? patchFields.connectionId : existing.connectionId,
      };

      const mergedParsed = CreateRuleSchema.safeParse(mergedCandidate);
      if (!mergedParsed.success) {
        return NextResponse.json(
          { error: "Validation failed on merged rule", details: mergedParsed.error.format() },
          { status: 400 }
        );
      }

      const updateData: any = {};
      if (patchFields.enabled !== undefined) updateData.enabled = patchFields.enabled;
      if (patchFields.name !== undefined) updateData.name = patchFields.name;
      if (patchFields.ruleType !== undefined) updateData.ruleType = patchFields.ruleType;
      if (patchFields.metric !== undefined) updateData.metric = patchFields.metric;
      if (patchFields.operator !== undefined) updateData.operator = patchFields.operator;
      if (patchFields.threshold !== undefined) updateData.threshold = patchFields.threshold;
      if (patchFields.pctThreshold !== undefined) updateData.pctThreshold = patchFields.pctThreshold;
      if (patchFields.expectedColumns !== undefined) updateData.expectedColumns = patchFields.expectedColumns;
      if (patchFields.severity !== undefined) updateData.severity = patchFields.severity;
      if (patchFields.notifyEmail !== undefined) updateData.notifyEmail = patchFields.notifyEmail;
      if (patchFields.notifyTelegram !== undefined) updateData.notifyTelegram = patchFields.notifyTelegram;

      const updated = await prisma.dataQualityRule.updateMany({
        where: { id: ruleId, workspaceId },
        data: updateData,
      });

      if (updated.count === 0) {
        return NextResponse.json(
          { error: "Rule not found in this workspace" },
          { status: 404 }
        );
      }

      const updatedRule = await prisma.dataQualityRule.findFirst({
        where: { id: ruleId, workspaceId },
      });

      return NextResponse.json({ success: true, rule: updatedRule });
    }

    return NextResponse.json({ error: "No valid update parameters provided" }, { status: 400 });
  } catch (err: unknown) {
    const rbacRes = toRbacResponse(err);
    if (rbacRes) return rbacRes;
    const msg = err instanceof Error ? err.message : "Failed to update settings";
    logger.error("[settings/data-quality][PATCH]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const ruleId = searchParams.get("ruleId");

  if (!workspaceId || !ruleId) {
    return NextResponse.json({ error: "workspaceId and ruleId are required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "delete_data_quality_rule",
    });

    // Secure tenant-isolated deletion
    const deleted = await prisma.dataQualityRule.deleteMany({
      where: { id: ruleId, workspaceId },
    });

    if (deleted.count === 0) {
      return NextResponse.json(
        { error: "Rule not found in this workspace" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const rbacRes = toRbacResponse(err);
    if (rbacRes) return rbacRes;
    const msg = err instanceof Error ? err.message : "Failed to delete rule";
    logger.error("[settings/data-quality][DELETE]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
