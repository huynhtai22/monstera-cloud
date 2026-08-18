import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from "@/lib/logger";
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from "@/lib/google-id-token";
import { getPlanLimits } from "@/lib/plan-config";

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken || typeof idToken !== 'string') {
      return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
    }

    const verification = await verifyGoogleIdToken(idToken, {
      audiences: getGoogleIdTokenAudienceAllowlist(),
    });
    if (!verification) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
    const email = verification.email;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json(
        { error: 'No Monstera account found. Sign up at monsteracloud.com', code: 'NO_ACCOUNT' },
        { status: 404 }
      );
    }

    const workspaces = await prisma.workspace.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      },
      select: {
        id: true,
        name: true,
        plan: true,
        members: { select: { userId: true, role: true } },
      },
      orderBy: { name: 'asc' },
    });

    if (workspaces.length === 0) {
      return NextResponse.json({ error: 'No workspace found', code: 'NO_WORKSPACE' }, { status: 404 });
    }

    return NextResponse.json({
      email: user.email,
      name: user.name,
      workspaces: workspaces.map((workspace) => {
        const limits = getPlanLimits(workspace.plan);
        const seatsUsed = workspace.members.length;
        return {
          id: workspace.id,
          name: workspace.name,
          plan: workspace.plan,
          seatsUsed,
          maxSeats: limits.maxSeats,
          maxConnections: limits.maxConnections,
          maxQueriesPerMonth: limits.maxQueriesPerMonth,
          isOverSeatLimit: seatsUsed > limits.maxSeats,
        };
      }),
    });
  } catch (error) {
    logger.error('[ADDON_AUTH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
