import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sanitizeConnectionCredentials } from "@/lib/sanitize-connection-credentials";
import { isSeededDemoSourceConnection } from "@/lib/demo-connection";

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
            };
        });

        return NextResponse.json(safeWorkspaces);
    } catch (error) {
        console.error("Error fetching workspaces:", error);
        return NextResponse.json({ error: "Failed to fetch workspaces", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}
