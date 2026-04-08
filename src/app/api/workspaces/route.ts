import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { safeDecrypt } from "@/lib/encryption";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
            });
        }

        let workspaces = await prisma.workspace.findMany({
            where: {
                members: {
                    some: {
                        userId: session.user.id
                    }
                }
            },
            include: {
                members: true,
                connections: true,
                pipelines: true,
                apiKeys: true
            }
        });

        // Fail-safe: If no workspaces exist for the user, create a default one on the fly
        if (workspaces.length === 0) {
            const newWorkspace = await prisma.workspace.create({
                data: {
                    name: "Personal Workspace",
                    slug: `personal-${session.user.id.slice(0, 8)}`,
                    ownerId: session.user.id,
                    members: {
                        create: {
                            userId: session.user.id,
                            role: "owner"
                        }
                    }
                },
                include: {
                    members: true,
                    connections: true,
                    pipelines: true,
                    apiKeys: true
                }
            });
            workspaces = [newWorkspace];
        }

        // Redact/enrich connection credentials for client use.
        // DB stores encrypted credentials; client should only receive non-sensitive metadata.
        const sanitizeCredentials = (raw: string) => {
            try {
                const parsed = JSON.parse(safeDecrypt(raw ?? "{}")) as Record<string, unknown>;
                const {
                    spreadsheetId,
                    shopId,
                    advertiserIds,
                    adAccountIds,
                    adAccounts,
                    customerIds,
                    mccId,
                    sandbox,
                    product,
                } = parsed as any;
                return JSON.stringify({
                    spreadsheetId,
                    shopId,
                    advertiserIds,
                    adAccountIds,
                    adAccounts,
                    customerIds,
                    mccId,
                    sandbox,
                    product,
                });
            } catch {
                return "{}";
            }
        };

        const safeWorkspaces = workspaces.map((w: any) => ({
            ...w,
            connections: (w.connections ?? []).map((c: any) => ({
                ...c,
                credentials: sanitizeCredentials(c.credentials),
            })),
        }));

        return NextResponse.json(safeWorkspaces);
    } catch (error) {
        console.error("Error fetching workspaces:", error);
        return NextResponse.json({ error: "Failed to fetch workspaces", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}
