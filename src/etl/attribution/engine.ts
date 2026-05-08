import prisma from '@/lib/prisma';
import { timeDecayWeights } from '@/etl/attribution/timeDecay';
import { scopeCampaignMetricWhere, scopeRetailOrderWhere } from '@/lib/workspace-scope';

/**
 * Multi-touch attribution (time-decay) on a per-workspace basis.
 * Joins retail orders with campaign metrics via UTM campaign matching.
 *
 * Phase A: deterministic exact match on utm_campaign == campaignName.
 * (Rule system is represented by UtmMappingRule but applied minimally here.)
 */
export async function computeAttributionSnapshots(opts: {
  workspaceId: string;
  startDate: Date;
  endDate: Date;
  model?: 'time_decay';
  halfLifeHours?: number;
}): Promise<{ snapshotsUpserted: number }> {
  const model = opts.model ?? 'time_decay';
  const halfLifeHours = opts.halfLifeHours ?? 24;

  const orders = await prisma.retailOrder.findMany({
    where: scopeRetailOrderWhere(opts.workspaceId, {
      createdAt: { gte: opts.startDate, lte: opts.endDate },
    }),
    select: {
      id: true,
      createdAtIso: true,
      grossRevenue: true,
      currency: true,
      utmCampaign: true,
    },
  });

  if (orders.length === 0) return { snapshotsUpserted: 0 };

  // Load campaign metrics (spend) in the same date window.
  const metrics = await prisma.campaignMetric.findMany({
    where: scopeCampaignMetricWhere(opts.workspaceId, {
      date: { gte: opts.startDate, lte: opts.endDate },
    }),
    select: {
      id: true,
      date: true,
      spend: true,
      campaignName: true,
      platform: true,
      campaignId: true,
    },
  });

  // Group spend by date+campaignName (simplest join key for phase A).
  const spendByDateCampaign = new Map<string, { spend: number; campaignId?: string; platform?: string }>();
  for (const m of metrics as any[]) {
    const day = new Date(m.date).toISOString().slice(0, 10);
    const key = `${day}::${m.campaignName}`;
    const prev = spendByDateCampaign.get(key);
    spendByDateCampaign.set(key, {
      spend: (prev?.spend ?? 0) + Number(m.spend ?? 0),
      campaignId: m.campaignId,
      platform: m.platform,
    });
  }

  // Build snapshots per day
  const daily: Record<string, { revenue: number; spend: number }> = {};

  for (const o of orders as any[]) {
    const orderTs = Date.parse(o.createdAtIso);
    if (!Number.isFinite(orderTs)) continue;
    const day = new Date(orderTs).toISOString().slice(0, 10);

    // Phase A: only attribute if utm_campaign is present and matches a campaignName in that day.
    const utmCampaign = (o.utmCampaign ?? '').trim();
    if (!utmCampaign) continue;

    const spendKey = `${day}::${utmCampaign}`;
    const spendEntry = spendByDateCampaign.get(spendKey);
    if (!spendEntry) continue;

    // Multi-touch placeholder: for now, model reduces to single touch (exact match).
    // We keep time-decay structure so we can extend to multiple touches later.
    const weights = timeDecayWeights([orderTs], orderTs, halfLifeHours);
    const w = weights[0] ?? 1;

    daily[day] = daily[day] ?? { revenue: 0, spend: 0 };
    daily[day].revenue += Number(o.grossRevenue ?? 0) * w;
    daily[day].spend += spendEntry.spend * w;
  }

  const days = Object.keys(daily);
  if (days.length === 0) return { snapshotsUpserted: 0 };

  let upserts = 0;
  for (const day of days) {
    const date = new Date(`${day}T00:00:00.000Z`);
    const attributedRevenue = daily[day].revenue;
    const adSpend = daily[day].spend;
    const netRoas = adSpend > 0 ? attributedRevenue / adSpend : 0;

    await prisma.attributionSnapshot.upsert({
      where: { workspaceId_date_model: { workspaceId: opts.workspaceId, date, model } } as any,
      update: { attributedRevenue, adSpend, netRoas },
      create: { workspaceId: opts.workspaceId, date, model, attributedRevenue, adSpend, netRoas },
    });
    upserts += 1;
  }

  return { snapshotsUpserted: upserts };
}

