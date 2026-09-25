import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { productionRouteDisabled } from "@/lib/request-auth";
import { getMonthlyAiBudget } from "@/lib/ai/budget";
import { enqueueAgentJob } from "@/lib/ai/jobs";
import { resolveReportingContext } from "@/lib/ai/reporting-context";
import { generateExecutiveBrief } from "@/lib/ai/executive-brief-generator";
import type { ExecutiveBriefResponse, ReportingWindowPreset } from "@/lib/ai/reporting-contracts";

function formatBriefExport(
  brief: ExecutiveBriefResponse,
  language: "en" | "vi",
  format: "markdown" | "text" | "print",
): string {
  const isVi = language === "vi";
  const b = brief;
  const lines: string[] = [];

  if (format === "markdown") {
    lines.push(`# ${b.clientName} — ${isVi ? "Báo cáo hiệu quả" : "Executive Performance Brief"}`);
    lines.push(
      `**${isVi ? "Kỳ báo cáo" : "Period"}:** ${b.window.current.start} ${isVi ? "đến" : "to"} ${b.window.current.end} (${b.window.daysCount} ${isVi ? "ngày" : "days"}, ${b.window.timezone})`,
    );
    lines.push(
      `**${isVi ? "Trạng thái sẵn sàng" : "Report Readiness"}:** ${b.readiness.status} · Fingerprint: \`${b.fingerprint.slice(0, 12)}...\``,
    );
    lines.push("");
    lines.push(`### ${isVi ? "Tóm tắt điều hành" : "Executive Headline"}`);
    lines.push(b.sections.headline);
    lines.push("");
    lines.push(`### ${isVi ? "Bảng chỉ số chính (KPIs)" : "KPI Scorecard"}`);
    for (const kpi of b.sections.kpiScorecard) {
      const currVal = kpi.currentValue != null ? kpi.currentValue.toLocaleString() : "N/A";
      const chg = kpi.percentageChange != null ? ` (${(kpi.percentageChange * 100).toFixed(1)}%)` : "";
      lines.push(`- **${kpi.name}:** ${kpi.currency ? `${kpi.currency} ` : ""}${currVal}${chg}`);
    }
    lines.push("");
    lines.push(`### ${isVi ? "Hiệu quả theo kênh" : "Channel Breakdown"}`);
    for (const ch of b.sections.channelScorecard) {
      const sp = ch.spend != null ? `${ch.currency} ${ch.spend.toLocaleString()}` : "N/A";
      const roas = ch.roas != null ? `${ch.roas.toFixed(2)}x` : "N/A";
      const extra =
        ch.orders != null
          ? ` · ${ch.orders.toLocaleString()} orders`
          : ch.conversions != null
            ? ` · ${ch.conversions.toLocaleString()} conv.`
            : "";
      lines.push(`- **${ch.channel.toUpperCase()}**: Spend ${sp} · ROAS ${roas}${extra}`);
    }
    lines.push("");
    lines.push(`### ${isVi ? "Quan sát và đóng góp chính" : "Key Observations"}`);
    for (const obs of b.sections.observations) {
      lines.push(`- ${obs.text}`);
    }
    lines.push("");
    lines.push(`### ${isVi ? "Hành động đề xuất" : "Suggested Next Steps"}`);
    for (const check of b.sections.suggestedChecks) {
      lines.push(`- ${check}`);
    }
    lines.push("");
    lines.push(`### ${isVi ? "Nguồn dữ liệu & Giới hạn" : "Sources & Limitations"}`);
    for (const lim of b.sections.sourcesAndLimitations) {
      lines.push(`- ${lim}`);
    }
  } else {
    // text / print clean formatting
    lines.push(`${b.clientName} — ${isVi ? "Báo cáo hiệu quả" : "Executive Performance Brief"}`);
    lines.push(
      `${isVi ? "Kỳ báo cáo" : "Period"}: ${b.window.current.start} ${isVi ? "đến" : "to"} ${b.window.current.end} (${b.window.daysCount} ${isVi ? "ngày" : "days"}, ${b.window.timezone})`,
    );
    lines.push(
      `${isVi ? "Trạng thái sẵn sàng" : "Report Readiness"}: ${b.readiness.status} · Fingerprint: ${b.fingerprint.slice(0, 12)}...`,
    );
    lines.push("=".repeat(50));
    lines.push(`${isVi ? "Tóm tắt điều hành" : "Executive Headline"}:`);
    lines.push(b.sections.headline);
    lines.push("");
    lines.push(`${isVi ? "Bảng chỉ số chính (KPIs)" : "KPI Scorecard"}:`);
    for (const kpi of b.sections.kpiScorecard) {
      const currVal = kpi.currentValue != null ? kpi.currentValue.toLocaleString() : "N/A";
      const chg = kpi.percentageChange != null ? ` (${(kpi.percentageChange * 100).toFixed(1)}%)` : "";
      lines.push(`  • ${kpi.name}: ${kpi.currency ? `${kpi.currency} ` : ""}${currVal}${chg}`);
    }
    lines.push("");
    lines.push(`${isVi ? "Hiệu quả theo kênh" : "Channel Breakdown"}:`);
    for (const ch of b.sections.channelScorecard) {
      const sp = ch.spend != null ? `${ch.currency} ${ch.spend.toLocaleString()}` : "N/A";
      const roas = ch.roas != null ? `${ch.roas.toFixed(2)}x` : "N/A";
      const extra =
        ch.orders != null
          ? ` · ${ch.orders.toLocaleString()} orders`
          : ch.conversions != null
            ? ` · ${ch.conversions.toLocaleString()} conv.`
            : "";
      lines.push(`  • ${ch.channel.toUpperCase()}: Spend ${sp} · ROAS ${roas}${extra}`);
    }
    lines.push("");
    lines.push(`${isVi ? "Quan sát chính" : "Key Observations"}:`);
    for (const obs of b.sections.observations) {
      lines.push(`  • ${obs.text}`);
    }
    lines.push("");
    lines.push(`${isVi ? "Nguồn dữ liệu & Giới hạn" : "Sources & Limitations"}:`);
    for (const lim of b.sections.sourcesAndLimitations) {
      lines.push(`  • ${lim}`);
    }
  }

  return lines.join("\n");
}

export async function POST(req: Request) {
  if (productionRouteDisabled("ENABLE_GOVERNED_ANALYST")) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid request payload" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (!clientId || clientId === "all" || clientId === "all_clients" || clientId === "unassigned") {
    return NextResponse.json(
      { error: "A concrete clientId is required. Briefs cannot target all clients or unassigned." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (body.action !== undefined && body.action !== "preview" && body.action !== "export") {
    return NextResponse.json(
      { error: "Invalid action. Must be 'preview' or 'export'." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const action: "preview" | "export" = body.action === "export" ? "export" : "preview";

  if (body.dateRange !== undefined && body.dateRange !== "last_7d" && body.dateRange !== "last_30d") {
    return NextResponse.json(
      { error: "Invalid dateRange. Must be 'last_7d' or 'last_30d'." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const dateRange: ReportingWindowPreset = body.dateRange === "last_30d" ? "last_30d" : "last_7d";

  if (body.language !== undefined && body.language !== "en" && body.language !== "vi") {
    return NextResponse.json(
      { error: "Invalid language. Must be 'en' or 'vi'." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const language: "en" | "vi" = body.language === "vi" ? "vi" : "en";

  if (body.format !== undefined && body.format !== "markdown" && body.format !== "text" && body.format !== "print") {
    return NextResponse.json(
      { error: "Invalid format. Must be 'markdown', 'text', or 'print'." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // 1. Authorization Gate (aligns with analyst minimum role: member)
  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "member",
      operation: action === "export" ? "export_executive_brief" : "read_executive_brief",
    });
  } catch (error) {
    const rbacRes = toRbacResponse(error);
    if (rbacRes) {
      rbacRes.headers.set("Cache-Control", "private, no-store");
      return rbacRes;
    }
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // 2. Validate client belongs to workspace
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true, name: true },
  });

  if (!client) {
    return NextResponse.json(
      { error: "Client not found in workspace" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // 3. AI Budget Check
  const budget = await getMonthlyAiBudget(workspaceId);

  // 4. Resolve Context in Single Database Snapshot
  try {
    const context = await resolveReportingContext({
      workspaceId,
      clientId,
      preset: dateRange,
    });

    // Handle Export Revalidation Action
    if (action === "export") {
      const expectedFingerprint =
        typeof body.expectedFingerprint === "string" ? body.expectedFingerprint.trim() : "";
      const format: "markdown" | "text" | "print" =
        body.format === "text" ? "text" : body.format === "print" ? "print" : "markdown";

      // A. Fingerprint stale check (detects underlying dataset mutations since preview)
      if (!expectedFingerprint || expectedFingerprint !== context.fingerprint) {
        return NextResponse.json(
          {
            error: "Dataset has changed since preview was generated. Regeneration required before export.",
            stale: true,
            currentFingerprint: context.fingerprint,
          },
          { status: 409, headers: { "Cache-Control": "private, no-store" } },
        );
      }

      // B. Export eligibility gate
      if (!context.readiness.exportEligible) {
        return NextResponse.json(
          {
            error: "Dataset is not report-ready for client delivery. Export blocked.",
            exportEligible: false,
            status: context.readiness.status,
            blockers: context.readiness.blockers,
          },
          { status: 403, headers: { "Cache-Control": "private, no-store" } },
        );
      }

      // C. Deterministic verified export generation
      const brief = await generateExecutiveBrief({
        context,
        language,
        allowModelRefinement: false,
      });

      const content = formatBriefExport(brief, language, format);

      return NextResponse.json(
        {
          ok: true,
          format,
          content,
          fingerprint: context.fingerprint,
          exportEligible: true,
          evaluatedAt: context.evaluatedAt,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    // Default: Preview Action
    const brief = await generateExecutiveBrief({
      context,
      language,
      allowModelRefinement: !budget.atOrOverLimit,
    });

    // Label non-ready previews as internal
    if (!brief.readiness.exportEligible) {
      brief.sections.headline = `[INTERNAL PREVIEW — NOT APPROVED FOR CLIENT DELIVERY] ${brief.sections.headline}`;
      brief.sections.sourcesAndLimitations.unshift(
        "INTERNAL PREVIEW ONLY: This dataset is not verified as report-ready or has unverified timezone context. Export, copy, and print are disabled for client delivery.",
      );
    }

    // Audit job on model assisted generation
    if (brief.generationMode === "model_assisted") {
      await enqueueAgentJob({
        workspaceId,
        userId: session.user.id,
        type: "exec_brief",
        payload: { clientId, dateRange, language, fingerprint: context.fingerprint },
        status: "completed",
        result: {
          headline: brief.sections.headline,
          exportEligible: brief.readiness.exportEligible,
          readinessStatus: brief.readiness.status,
        },
      }).catch(() => {
        // Logging/audit failure must not fail client readout
      });
    }

    return NextResponse.json(
      {
        brief,
        fingerprint: context.fingerprint,
        exportEligible: brief.readiness.exportEligible,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to generate brief";
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
