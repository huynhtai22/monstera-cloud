import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildPerformanceContext } from "@/lib/ai/build-performance-context";
import { generatePerformanceSummary } from "@/lib/ai/openai-summary";
import { logger } from "@/lib/logger";

/**
 * POST /api/ai/performance-summary
 * Body: { workspaceId: string }
 * Returns LLM summary of last-7-day workspace metrics (requires OPENAI_API_KEY).
 */
export async function POST(req: Request) {
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

        const membership = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
            select: { id: true },
        });
        if (!membership) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
