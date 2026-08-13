import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { generateApiKey, publicApiKeyRow } from "@/lib/api-key-security";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

export async function GET(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get("workspaceId");

        if (!workspaceId) {
            return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
        }

        await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "admin", operation: "list_api_keys" });

        const keys = await prisma.apiKey.findMany({
            where: { workspaceId, revokedAt: null },
            orderBy: { createdAt: "desc" }
        });

        return NextResponse.json(keys.map(publicApiKeyRow));
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("Error fetching API keys:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { workspaceId, name } = await request.json();

        if (!workspaceId) {
            return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
        }

        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId,
            minimumRole: "admin",
            operation: "create_api_key",
        });

        // Generate a secure API Key
        const generated = generateApiKey();

        const newKey = await prisma.apiKey.create({
            data: {
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                keyLastFour: generated.keyLastFour,
                name: name || "Default Extension Key",
                workspaceId: workspaceId
            }
        });
        await prisma.auditEvent.create({ data: { workspaceId, actorUserId: session.user.id, action: "api_key.created", resource: "api_key", resourceId: newKey.id } });

        // Full key only on create; list endpoints use keyMasked.
        return NextResponse.json(
            {
                id: newKey.id,
                name: newKey.name,
                workspaceId: newKey.workspaceId,
                createdAt: newKey.createdAt,
                key: generated.secret,
            },
            { status: 201 }
        );
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("Error creating API key:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const keyId = searchParams.get("id");
        const workspaceId = searchParams.get("workspaceId");

        if (!keyId || !workspaceId) {
            return NextResponse.json({ error: "Missing id or workspaceId" }, { status: 400 });
        }

        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId,
            minimumRole: "admin",
            operation: "revoke_api_key",
        });

        const revoked = await prisma.apiKey.updateMany({
            where: {
                id: keyId,
                workspaceId: workspaceId,
                revokedAt: null,
            },
            data: { revokedAt: new Date() },
        });
        if (revoked.count !== 1) return NextResponse.json({ error: "API key not found" }, { status: 404 });
        await prisma.auditEvent.create({ data: { workspaceId, actorUserId: session.user.id, action: "api_key.revoked", resource: "api_key", resourceId: keyId } });

        return NextResponse.json({ success: true });
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("Error deleting API key:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
