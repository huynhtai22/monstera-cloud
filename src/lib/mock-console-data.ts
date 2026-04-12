/**
 * Synthetic console data for product demos / screenshots.
 * Dimensions & platform labels align with Meta Ads, Google Ads, and Shopee usage in the app.
 */

export type WorkspaceDemoFlags = {
  demoMockMode: boolean;
  demoMockMeta: boolean;
  demoMockShopee: boolean;
  demoMockGoogleAds: boolean;
};

export const MOCK_CLIENT_IDS = {
  aurora: "mock_client_aurora_retail",
  pacific: "mock_client_pacific_beauty",
  summit: "mock_client_summit_fnb",
} as const;

/** Three fictional agency clients for slides / demos */
export const MOCK_CLIENTS = [
  {
    id: MOCK_CLIENT_IDS.aurora,
    name: "Aurora Retail VN",
    description: "Fashion & lifestyle — Meta + Google Ads",
    _count: { pipelines: 4, connections: 5 },
  },
  {
    id: MOCK_CLIENT_IDS.pacific,
    name: "Pacific Beauty Co.",
    description: "Shopee Mall + TikTok catalog sync",
    _count: { pipelines: 3, connections: 4 },
  },
  {
    id: MOCK_CLIENT_IDS.summit,
    name: "Summit F&B Group",
    description: "Google Ads Search + Shopee storefront",
    _count: { pipelines: 5, connections: 6 },
  },
] as const;

/** Fictional team for Team tab demos (not persisted users) */
export const MOCK_TEAM = [
  {
    id: "mock_member_pm",
    name: "Minh Anh Nguyen",
    email: "minh.anh@agency-demo.vn",
    role: "Admin",
    title: "Delivery lead",
  },
  {
    id: "mock_member_analyst",
    name: "Hữu Phước Trần",
    email: "phuoc.tran@agency-demo.vn",
    role: "Member",
    title: "Performance analyst",
  },
  {
    id: "mock_member_ops",
    name: "Thu Hà Lê",
    email: "thuha.le@agency-demo.vn",
    role: "Member",
    title: "Ops & integrations",
  },
] as const;

function seedDay(seed: string, dayIndex: number): number {
  let h = 0;
  const s = `${seed}-${dayIndex}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function anyPlatformEnabled(flags: WorkspaceDemoFlags): boolean {
  return (
    flags.demoMockMode &&
    (flags.demoMockMeta || flags.demoMockShopee || flags.demoMockGoogleAds)
  );
}

/** Extra row volume per day from enabled ad/commerce platforms (deterministic). */
export function mockDailyIngestRows(
  dateStr: string,
  flags: WorkspaceDemoFlags
): number {
  if (!anyPlatformEnabled(flags)) return 0;
  const dayIndex = parseInt(dateStr.replaceAll("-", ""), 10) || 0;
  let base = 0;
  if (flags.demoMockMeta) {
    base += 800 + (seedDay("meta", dayIndex) % 4200);
  }
  if (flags.demoMockGoogleAds) {
    base += 600 + (seedDay("gads", dayIndex) % 3100);
  }
  if (flags.demoMockShopee) {
    base += 400 + (seedDay("shopee", dayIndex) % 2800);
  }
  return base;
}

export function mergeChartData(
  chartData: { date: string; count: number }[],
  flags: WorkspaceDemoFlags
): { date: string; count: number }[] {
  if (!flags.demoMockMode) return chartData;
  return chartData.map((row) => ({
    ...row,
    count: row.count + mockDailyIngestRows(row.date, flags),
  }));
}

export function buildMockClientHealth(flags: WorkspaceDemoFlags) {
  if (!flags.demoMockMode) return [];

  const statuses: Array<"healthy" | "stale" | "error"> = ["healthy", "healthy", "stale"];
  const connByClient = [4, 3, 5];
  const staleByClient = [0, 0, 1];

  return MOCK_CLIENTS.map((c, i) => ({
    id: c.id,
    name: c.name,
    status: statuses[i],
    totalConnections: connByClient[i],
    staleCount: staleByClient[i],
    lastActivity: new Date(Date.now() - (i + 1) * 36 * 60 * 60 * 1000),
    isDemo: true as const,
  }));
}

export function mergeClientHealth(
  real: Array<{
    id: string;
    name: string;
    status: string;
    totalConnections: number;
    staleCount: number;
    lastActivity: Date | string | null;
  }>,
  flags: WorkspaceDemoFlags
) {
  if (!flags.demoMockMode) return real;
  const mock = buildMockClientHealth(flags);
  return [...mock, ...real];
}

export function mockConnectionDelta(flags: WorkspaceDemoFlags): number {
  if (!flags.demoMockMode) return 0;
  let n = 0;
  if (flags.demoMockMeta) n += 2;
  if (flags.demoMockGoogleAds) n += 2;
  if (flags.demoMockShopee) n += 2;
  return n;
}

export function mockUnassignedCount(_real: number, flags: WorkspaceDemoFlags): number {
  if (!flags.demoMockMode) return _real;
  // Cleaner portfolio shot: show fewer unassigned when demo is on
  return Math.min(_real, 2);
}

export function buildMockAttributionSnapshots(
  days: number,
  flags: WorkspaceDemoFlags
): Array<{
  date: Date;
  netRoas: number;
  adSpend: number;
  attributedRevenue: number;
  model: string;
}> {
  if (!anyPlatformEnabled(flags)) return [];
  const out: Array<{
    date: Date;
    netRoas: number;
    adSpend: number;
    attributedRevenue: number;
    model: string;
  }> = [];
  const end = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    d.setHours(12, 0, 0, 0);
    const di = parseInt(d.toISOString().slice(0, 10).replaceAll("-", ""), 10);
    let spend = 0;
    if (flags.demoMockMeta) spend += 180 + (seedDay("mspend", di) % 900);
    if (flags.demoMockGoogleAds) spend += 220 + (seedDay("gspend", di) % 1100);
    if (flags.demoMockShopee) spend += 95 + (seedDay("sspend", di) % 520);
    const roasBase =
      2.1 +
      (flags.demoMockMeta ? 0.25 : 0) +
      (flags.demoMockGoogleAds ? 0.15 : 0) +
      (flags.demoMockShopee ? 0.2 : 0);
    const jitter = 0.85 + (seedDay("roas", di) % 35) / 100;
    const netRoas = Number((roasBase * jitter).toFixed(2));
    const adSpend = Number(spend.toFixed(2));
    const attributedRevenue = Number((adSpend * netRoas).toFixed(2));
    out.push({
      date: d,
      netRoas,
      adSpend,
      attributedRevenue,
      model: "time_decay",
    });
  }
  return out;
}

export function clientsApiPayload(workspaceId: string, flags: WorkspaceDemoFlags) {
  if (!flags.demoMockMode) return [];
  const now = new Date().toISOString();
  return MOCK_CLIENTS.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    logoUrl: null as string | null,
    workspaceId,
    createdAt: now,
    updatedAt: now,
    isDemo: true,
    _count: { ...c._count },
  }));
}

/** Demo-only client rows — not stored in DB */
export function isMockClientId(id: string): boolean {
  return id.startsWith("mock_client_");
}
