import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

async function requireMembership(workspaceId: string, userId: string) {
    return (prisma.workspaceMember as any).findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
    });
}

/**
 * PATCH /api/workspaces/[id]
 * Update workspace fields (e.g. Telegram chat ID for alerts).
 */
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: workspaceId } = await params;
        const membership = await requireMembership(workspaceId, session.user.id);
        if (!membership) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const {
            telegramChatId,
            demoMockMode,
            demoMockMeta,
            demoMockShopee,
            demoMockGoogleAds,
        } = body as {
            telegramChatId?: string | null;
            demoMockMode?: boolean;
            demoMockMeta?: boolean;
            demoMockShopee?: boolean;
            demoMockGoogleAds?: boolean;
        };

        const data: {
            telegramChatId?: string | null;
            demoMockMode?: boolean;
            demoMockMeta?: boolean;
            demoMockShopee?: boolean;
            demoMockGoogleAds?: boolean;
        } = {};
        if ("telegramChatId" in body) {
            const v = telegramChatId;
            if (v === null || v === "") {
                data.telegramChatId = null;
            } else if (typeof v === "string") {
                const t = v.trim();
                data.telegramChatId = t.length ? t : null;
            }
        }
        if (typeof demoMockMode === "boolean") data.demoMockMode = demoMockMode;
        if (typeof demoMockMeta === "boolean") data.demoMockMeta = demoMockMeta;
        if (typeof demoMockShopee === "boolean") data.demoMockShopee = demoMockShopee;
        if (typeof demoMockGoogleAds === "boolean") data.demoMockGoogleAds = demoMockGoogleAds;

        if (Object.keys(data).length === 0) {
            return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
        }

        const updated = await prisma.workspace.update({
            where: { id: workspaceId },
            data,
            select: {
                id: true,
                name: true,
                slug: true,
                telegramChatId: true,
                demoMockMode: true,
                demoMockMeta: true,
                demoMockShopee: true,
                demoMockGoogleAds: true,
            },
        });

        return NextResponse.json(updated);
    } catch (e: unknown) {
        logger.error("[PATCH /api/workspaces/[id]]", e);
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Update failed" },
            { status: 500 }
        );
    }
}
