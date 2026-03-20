
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const userCount = await prisma.user.count();
    const workspaceCount = await prisma.workspace.count();
    const lastUsers = await prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { email: true, name: true, createdAt: true }
    });

    return NextResponse.json({
      userCount,
      workspaceCount,
      lastUsers,
      dbUrl: process.env.DATABASE_URL?.split('@')[1] // Hide credentials
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
