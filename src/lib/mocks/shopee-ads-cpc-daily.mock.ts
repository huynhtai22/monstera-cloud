/**
 * Fixture payloads for local Shopee Ads pipeline tests (no live API).
 */

export function mockShopeeAdsCpcDailyResponse(opts?: {
  shopId?: number;
  daysYmd?: string[];
}): { response: Record<string, unknown>[] } {
  const daysYmd = opts?.daysYmd ?? ["2026-01-10", "2026-01-11"];
  const rows = daysYmd.flatMap((ymd, dayIdx) => {
    const [y, m, d] = ymd.split("-");
    const date = `${d}-${m}-${y}`;
    return [
      {
        date,
        campaign_id: 100001 + dayIdx,
        campaign_name: `Mock campaign ${dayIdx + 1}`,
        impression: 10_000 + dayIdx * 100,
        clicks: 200 + dayIdx * 5,
        expense: 150.5 + dayIdx * 10,
        broad_gmv: 900 + dayIdx * 50,
        broad_order: 12 + dayIdx,
        ctr: 0.02,
        broad_roas: 5.5,
        currency: "VND",
        shop_id: opts?.shopId ?? 900012345,
      },
      {
        date,
        campaign_id: 100002 + dayIdx,
        campaign_name: `Mock campaign B ${dayIdx + 1}`,
        ad_id: 50001 + dayIdx,
        impressions: 3000,
        clicks: 40,
        expense: 45,
        broad_gmv: 120,
        broad_order: 2,
        currency: "VND",
      },
    ];
  });
  return { response: rows };
}
