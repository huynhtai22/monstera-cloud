import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { logger } from "@/lib/logger";
import { z } from "zod";

const CreateRuleSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  name: z.string().min(1, "name is required").max(100),
  ruleType: z.enum(["threshold", "comparison", "schema_check"]),
  metric: z.enum(["revenue", "orders", "roas", "row_count", "spend", "conversions", "impressions", "clicks"]),
  operator: z.enum(["gt", "lt", "eq", "drop_pct", "increase_pct", "schema_check"]),
  threshold: z.number().optional(),
  pctThreshold: z.number().optional(),
  severity: z.enum(["warning", "critical"]),
  pipelineId: z.string().optional().nullable(),
  connectionId: z.string().optional().nullable(),
});

const PatchRuleSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  ruleId: z.string().optional(),
  enabled: z.boolean().optional(),
  telegramChatId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
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
  const session = await getServerSession(authOptions);
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

  const {
    workspaceId,
    name,
    ruleType,
    metric,
    operator,
    threshold,
    pctThreshold,
    severity,
    pipelineId,
    connectionId,
  } = parsed.data;

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "create_data_quality_rule",
    });

    const rule = await prisma.dataQualityRule.create({
      data: {
        workspaceId,
        name,
        ruleType,
        metric,
        operator,
        threshold: threshold !== undefined ? Number(threshold) : null,
        pctThreshold: pctThreshold !== undefined ? Number(pctThreshold) : null,
        severity,
        enabled: true,
        pipelineId: pipelineId || null,
        connectionId: connectionId || null,
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
  const session = await getServerSession(authOptions);
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

  const { workspaceId, ruleId, enabled, telegramChatId } = parsed.data;

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

    if (ruleId && enabled !== undefined) {
      // Secure tenant-isolated update: rule must belong to the caller's workspaceId
      const updated = await prisma.dataQualityRule.updateMany({
        where: { id: ruleId, workspaceId },
        data: { enabled },
      });

      if (updated.count === 0) {
        return NextResponse.json(
          { error: "Rule not found in this workspace" },
          { status: 404 }
        );
      }

      const rule = await prisma.dataQualityRule.findFirst({
        where: { id: ruleId, workspaceId },
      });

      return NextResponse.json({ success: true, rule });
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
  const session = await getServerSession(authOptions);
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
