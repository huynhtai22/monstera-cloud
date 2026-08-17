import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/rbac";
import { logger } from "@/lib/logger";

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

  let body: {
    workspaceId?: string;
    name?: string;
    ruleType?: "threshold" | "comparison" | "schema_check";
    metric?: "revenue" | "orders" | "roas" | "row_count" | "spend" | "conversions";
    operator?: "gt" | "lt" | "eq" | "drop_pct" | "increase_pct";
    threshold?: number;
    pctThreshold?: number;
    severity?: "warning" | "critical";
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, name, ruleType, metric, operator, threshold, pctThreshold, severity } = body;

  if (!workspaceId || !name || !ruleType || !metric || !operator || !severity) {
    return NextResponse.json(
      { error: "workspaceId, name, ruleType, metric, operator, and severity are required" },
      { status: 400 }
    );
  }

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
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: unknown) {
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

  let body: {
    workspaceId?: string;
    ruleId?: string;
    enabled?: boolean;
    telegramChatId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, ruleId, enabled, telegramChatId } = body;
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

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
      const updated = await prisma.dataQualityRule.update({
        where: { id: ruleId },
        data: { enabled },
      });
      return NextResponse.json({ success: true, rule: updated });
    }

    return NextResponse.json({ error: "No update parameters provided" }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update";
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

    await prisma.dataQualityRule.deleteMany({
      where: { id: ruleId, workspaceId },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete rule";
    logger.error("[settings/data-quality][DELETE]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
