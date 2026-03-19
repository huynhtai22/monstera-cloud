import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
            });
        }

        const workspaces = await prisma.workspace.findMany({
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
                pipelines: true
            }
        });

        return NextResponse.json(workspaces);
    } catch (error) {
        console.error("Error fetching workspaces:", error);
        return NextResponse.json({ error: "Failed to fetch workspaces" }, { status: 500 });
    }
}
