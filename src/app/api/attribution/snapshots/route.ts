import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { computeAttributionSnapshots } from '@/etl/attribution/engine';
import {
  buildMockAttributionSnapshots,
  type WorkspaceDemoFlags,
} from '@/lib/mock-console-data';
import { productionRouteDisabled } from '@/lib/request-auth';

function dateKey(d: Date | string): string {
  const x = d instanceof Date ? d : new Date(d);
  return x.toISOString().slice(0, 10);
}

function mergeAttributionRows(
  real: Array<{
    date: Date;
    netRoas: number;
    adSpend: number;
    attributedRevenue: number;
    model: string;
  }>,
  mock: Array<{
    date: Date;
    netRoas: number;
    adSpend: number;
    attributedRevenue: number;
    model: string;
  }>
) {
  const map = new Map<string, (typeof real)[0]>();
  for (const m of mock) {
    map.set(dateKey(m.date), m);
  }
  for (const r of real) {
    map.set(dateKey(r.date), r);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

/**
 * GET /api/attribution/snapshots?workspaceId=...&days=14
 * Computes (best-effort) and returns attribution snapshots for a workspace.
 */
export async function GET(req: Request) {
  if (productionRouteDisabled("ENABLE_ADVANCED_ATTRIBUTION")) return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      demoMockMode: true,
      demoMockMeta: true,
      demoMockShopee: true,
      demoMockGoogleAds: true,
    },
  });
  const demoFlags: WorkspaceDemoFlags = {
    demoMockMode: ws?.demoMockMode ?? false,
    demoMockMeta: ws?.demoMockMeta ?? false,
    demoMockShopee: ws?.demoMockShopee ?? false,
    demoMockGoogleAds: ws?.demoMockGoogleAds ?? false,
  };

  const dayCount = Math.max(1, Math.min(90, days));
  const mockRows = buildMockAttributionSnapshots(dayCount, demoFlags);
  const realRows = snapshots.map((s) => ({
    date: s.date,
    netRoas: s.netRoas,
    adSpend: s.adSpend,
    attributedRevenue: s.attributedRevenue,
    model: s.model,
  }));

  const merged =
    demoFlags.demoMockMode && mockRows.length > 0
      ? mergeAttributionRows(realRows, mockRows)
      : realRows;

  const out = merged.map((row) => ({
    ...row,
    date: row.date,
  }));

  return NextResponse.json({
    snapshots: out,
    demoMockMode: demoFlags.demoMockMode,
  });
}
