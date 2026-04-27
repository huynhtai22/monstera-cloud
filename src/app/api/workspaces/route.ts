import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sanitizeConnectionCredentials } from "@/lib/sanitize-connection-credentials";
import { isSeededDemoSourceConnection } from "@/lib/demo-connection";
import { toPublicApiKeyRow } from "@/lib/mask-api-key";
import { logger } from "@/lib/logger";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
            });
        }

        let workspaces = await prisma.workspace.findMany({
            where: {
                OR: [
                    { ownerId: session.user.id },
                    { members: { some: { userId: session.user.id } } },
                ],
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

        const safeWorkspaces = workspaces.map((w: any) => {
            const demoMode = w.demoMockMode === true;
            const connections = (w.connections ?? []).filter((c: any) => {
                if (demoMode) return true;
                return !isSeededDemoSourceConnection({
                    type: c.type,
                    name: c.name,
                    provider: c.provider,
                    credentials: c.credentials,
                });
            });
            return {
                ...w,
                connections: connections.map((c: any) => ({
                    ...c,
                    credentials: sanitizeConnectionCredentials(c.credentials),
                })),
                apiKeys: (w.apiKeys ?? []).map((k: { id: string; name: string; createdAt: Date; lastUsedAt: Date | null; key: string; keyPrefix?: string | null }) =>
                    toPublicApiKeyRow(k)
                ),
            };
        });

        return NextResponse.json(safeWorkspaces);
    } catch (error) {
        logger.error("Error fetching workspaces:", error);
        const body =
            process.env.NODE_ENV === "production"
                ? { error: "Failed to fetch workspaces" }
                : {
                      error: "Failed to fetch workspaces",
                      details: error instanceof Error ? error.message : String(error),
                  };
        return NextResponse.json(body, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { name } = await request.json().catch(() => ({}));
        const workspaceName = typeof name === "string" && name.trim().length > 0
            ? name.trim()
            : "New Workspace";

        const slugBase = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
        const slug = `${slugBase}-${session.user.id.slice(0, 8)}`;

        const newWorkspace = await prisma.workspace.create({
            data: {
                name: workspaceName,
                slug,
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

        return NextResponse.json(newWorkspace, { status: 201 });
    } catch (error) {
        logger.error("Error creating workspace:", error);
        const body =
            process.env.NODE_ENV === "production"
                ? { error: "Failed to create workspace" }
                : {
                      error: "Failed to create workspace",
                      details: error instanceof Error ? error.message : String(error),
                  };
        return NextResponse.json(body, { status: 500 });
    }
}
