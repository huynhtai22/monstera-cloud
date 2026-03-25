import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPlanLimits, userSyncCron } from "@/lib/plan-config";

/**
 * POST /api/pipelines
 * Creates a new pipeline, enforcing the plan's maximum pipeline count.
 * Assigns a staggered cron offset per user to prevent burst load.
 */
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, name, sourceConnectionId, destinationConnectionId, scheduleCron } = body;

    if (!workspaceId || !name || !sourceConnectionId || !destinationConnectionId) {
        return NextResponse.json(
            { error: "workspaceId, name, sourceConnectionId, and destinationConnectionId are required" },
            { status: 400 }
        );
    }

    // Verify the user is a member of this workspace
    const membership = await (prisma.workspaceMember as any).findFirst({
        where: { workspaceId, userId: session.user.id },
    });
    if (!membership) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Fetch user plan and enforce pipeline count cap
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { plan: true } });
    const limits = getPlanLimits(user?.plan ?? "free");

    if (limits.maxPipelines !== Infinity) {
        const existingCount = await prisma.pipeline.count({ where: { workspaceId } });
        if (existingCount >= limits.maxPipelines) {
            return NextResponse.json(
                {
                    error: `Your ${user?.plan ?? "free"} plan allows a maximum of ${limits.maxPipelines} pipeline${limits.maxPipelines === 1 ? "" : "s"}. Upgrade to add more.`,
                    code: "PIPELINE_LIMIT_REACHED",
                    limit: limits.maxPipelines,
                    current: existingCount,
                },
                { status: 403 }
            );
        }
    }

    // Assign staggered cron offset — use provided value or derive from user ID
    const cron = scheduleCron ?? userSyncCron(session.user.id);

    const pipeline = await prisma.pipeline.create({
        data: {
            workspaceId,
            name,
            sourceConnectionId,
            destinationConnectionId,
            scheduleCron: cron,
        },
        include: { sourceConnection: true, destinationConnection: true },
    });

    return NextResponse.json(pipeline, { status: 201 });
}

export async function GET(request: Request) {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
        });
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    try {
        const pipelines = await prisma.pipeline.findMany({
            where: {
                ...(workspaceId ? { workspaceId } : {}),
                workspace: {
                    members: {
                        some: {
                            userId: session.user.id
                        }
                    }
                }
            },
            include: {
                sourceConnection: true,
                destinationConnection: true,
                logs: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        return NextResponse.json(pipelines);
    } catch (error) {
        console.error("Error fetching pipelines:", error);
        return NextResponse.json({ error: "Failed to fetch pipelines" }, { status: 500 });
    }
}
