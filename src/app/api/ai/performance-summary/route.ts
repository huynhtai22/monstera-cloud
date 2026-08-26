import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildPerformanceContext } from "@/lib/ai/build-performance-context";
import { generatePerformanceSummary } from "@/lib/ai/openai-summary";
import { logger } from "@/lib/logger";
import { isLegacyPerformanceSummaryRetired } from "@/lib/ai/legacy-performance-summary";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * POST /api/ai/performance-summary
 * Body: { workspaceId: string }
 * Returns LLM summary of last-7-day workspace metrics (requires OPENAI_API_KEY).
 * Production always 410s — ENABLE_AI_SUMMARIES cannot reopen this ungoverned path.
 */
export async function POST(req: Request) {
    if (isLegacyPerformanceSummaryRetired()) {
        return NextResponse.json(
            {
                error: "Gone",
                hint: "Use the governed analyst when ENABLE_GOVERNED_ANALYST is enabled.",
            },
            { status: 410 },
        );
    }
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
        if (!workspaceId) {
            return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
        }

        try {
            await requireWorkspaceAccess({
                userId: session.user.id,
                workspaceId,
                minimumRole: "viewer",
                operation: "generate_performance_summary",
            });
        } catch (error) {
            return toRbacResponse(error) ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (!process.env.OPENAI_API_KEY?.trim()) {
            return NextResponse.json(
                {
                    error: "AI summaries are not configured",
                    hint: "Set OPENAI_API_KEY in the server environment. Optional: AI_SUMMARY_MODEL (default gpt-4o-mini).",
                },
                { status: 503 }
            );
        }

        const context = await buildPerformanceContext(workspaceId);
        const result = await generatePerformanceSummary(context);

        return NextResponse.json({
            ...result,
            contextPreview: process.env.NODE_ENV === "development" ? context : undefined,
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Summary failed";
        logger.error("[POST /api/ai/performance-summary]", e);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
