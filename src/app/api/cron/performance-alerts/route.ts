import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { computeAttributionSnapshots } from '@/etl/attribution/engine';
import { sendDataFreshnessAlertEmail, sendPerformanceAlertEmail } from '@/lib/mail';
import { requireCronSecret } from '@/lib/request-auth';

/**
 * GET /api/cron/performance-alerts
 * Daily alerting for data freshness and Net ROAS anomalies.
 */
export async function GET(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true, ownerId: true },
    take: 500,
  });

  const now = Date.now();
  const freshnessWindowMs = 26 * 60 * 60 * 1000;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const end = new Date();

  const results: any[] = [];

  for (const ws of workspaces) {
    const owner = await prisma.user.findUnique({
      where: { id: ws.ownerId },
      select: { email: true },
    });
    if (!owner?.email) continue;

    // Freshness: last successful sync within 8 hours?
    const lastSuccess = await prisma.syncLog.findFirst({
      where: { pipeline: { workspaceId: ws.id }, status: 'success' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const lastTs = lastSuccess?.createdAt?.getTime() ?? 0;
    const hoursStale = Math.floor((now - lastTs) / (60 * 60 * 1000));
    if (!lastSuccess || now - lastTs > freshnessWindowMs) {
      await sendDataFreshnessAlertEmail(owner.email, ws.name, Math.max(26, hoursStale)).catch(() => {});
      results.push({ workspaceId: ws.id, alert: 'freshness', hoursStale });
    }

    // Performance anomaly: compute attribution (best-effort) and alert on yesterday
    await computeAttributionSnapshots({ workspaceId: ws.id, startDate: start, endDate: end, model: 'time_decay' });
    const snap = await prisma.attributionSnapshot.findFirst({
      where: { workspaceId: ws.id, model: 'time_decay', date: { gte: new Date(yesterday.toISOString().slice(0, 10) + 'T00:00:00.000Z') } },
      orderBy: { date: 'desc' },
      select: { date: true, netRoas: true, adSpend: true },
    });

    if (snap && snap.adSpend > 50 && snap.netRoas > 0 && snap.netRoas < 0.8) {
      await sendPerformanceAlertEmail(owner.email, ws.name, snap.netRoas, snap.adSpend, snap.date.toISOString().slice(0, 10)).catch(() => {});
      results.push({ workspaceId: ws.id, alert: 'performance', netRoas: snap.netRoas, adSpend: snap.adSpend });
    }
  }

  return NextResponse.json({ ok: true, results });
}
