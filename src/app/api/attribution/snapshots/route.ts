import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { computeAttributionSnapshots } from '@/etl/attribution/engine';

/**
 * GET /api/attribution/snapshots?workspaceId=...&days=14
 * Computes (best-effort) and returns attribution snapshots for a workspace.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get('workspaceId') ?? '';
  const days = Number(searchParams.get('days') ?? '14');

  if (!workspaceId) return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });

  // Verify membership
  const membership = await (prisma.workspaceMember as any).findFirst({
    where: { workspaceId, userId: session.user.id },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const endDate = new Date();
  const startDate = new Date(Date.now() - Math.max(1, Math.min(90, days)) * 24 * 60 * 60 * 1000);

  await computeAttributionSnapshots({ workspaceId, startDate, endDate, model: 'time_decay' });

  const snapshots = await prisma.attributionSnapshot.findMany({
    where: { workspaceId, date: { gte: startDate, lte: endDate }, model: 'time_decay' },
    orderBy: { date: 'asc' },
    take: 200,
  });

  return NextResponse.json({ snapshots });
}

