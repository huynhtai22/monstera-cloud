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

    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    if (!user) {
      // Auto-provision user & Agency Pilot Workspace on first Google Sheets open
      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email,
            name: email.split("@")[0],
            plan: "pilot",
            emailVerified: new Date(),
          },
        });
        await tx.workspace.create({
          data: {
            name: `${newUser.name}'s Agency`,
            slug: `agency-${newUser.id.slice(0, 8)}`,
            ownerId: newUser.id,
            plan: "pilot",
            status: "PILOT",
            members: { create: { userId: newUser.id, role: "owner" } },
            providerAccess: {
              create: [
                { provider: "meta_ads", enabled: true },
                { provider: "google_ads", enabled: true },
                { provider: "tiktok_business", enabled: true },
                { provider: "shopee", enabled: true },
              ],
            },
          },
        });
        return newUser;
      });
    }

    let workspaces = await prisma.workspace.findMany({
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
      const newWs = await prisma.workspace.create({
        data: {
          name: "Agency Workspace",
          slug: `agency-${user.id.slice(0, 8)}`,
          ownerId: user.id,
          plan: "pilot",
          status: "PILOT",
          members: { create: { userId: user.id, role: "owner" } },
          providerAccess: {
            create: [
              { provider: "meta_ads", enabled: true },
              { provider: "google_ads", enabled: true },
              { provider: "tiktok_business", enabled: true },
              { provider: "shopee", enabled: true },
            ],
          },
        },
        select: {
          id: true,
          name: true,
          plan: true,
          members: { select: { userId: true, role: true } },
        },
      });
      workspaces = [newWs];
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
