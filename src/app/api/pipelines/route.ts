import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

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
