export const sections = [
  { id: "dashboard", title: "Dashboard", group: "Overview", path: "/console" },
  {
    id: "operations",
    title: "Operations",
    group: "Overview",
    path: "/operations",
  },
  { id: "sources", title: "Sources", group: "Pipelines", path: "/sources" },
  { id: "reports", title: "Reports", group: "Pipelines", path: "/reports" },
  { id: "warehouse", title: "Warehouse", group: "Data", path: "/explorer" },
  { id: "exports", title: "Exports & API", group: "Data", path: "/exports" },
  { id: "clients", title: "Clients", group: "Management", path: "/clients" },
  { id: "settings", title: "Settings", group: "Management", path: "/settings" },
] as const;
export type SectionId = (typeof sections)[number]["id"];
export function sectionFromHash(): SectionId {
  if (typeof window === "undefined") return "dashboard";
  const id = window.location.hash.slice(1);
  return sections.find((section) => section.id === id)?.id ?? "dashboard";
}
export function subscribeSection(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
export type CampaignRow = {
  id: string;
  name: string;
  client: string;
  platform: string;
  date: string;
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
};
export const campaignRows: CampaignRow[] = [
  {
    id: "c1",
    name: "Autumn essentials · Prospecting",
    client: "North Supply",
    platform: "meta_ads",
    date: "2026-09-27",
    spend: 3120,
    revenue: 13920,
    impressions: 480200,
    clicks: 14820,
    conversions: 684,
    currency: "USD",
  },
  {
    id: "c2",
    name: "Brand search · Always on",
    client: "Forma Studio",
    platform: "google_ads",
    date: "2026-09-27",
    spend: 2260,
    revenue: 11870,
    impressions: 362400,
    clicks: 10960,
    conversions: 542,
    currency: "USD",
  },
  {
    id: "c3",
    name: "New collection · Video",
    client: "North Supply",
    platform: "tiktok_business",
    date: "2026-09-27",
    spend: 1890,
    revenue: 5670,
    impressions: 516800,
    clicks: 11400,
    conversions: 286,
    currency: "USD",
  },
  {
    id: "c4",
    name: "Returning customers",
    client: "Goodkind",
    platform: "meta_ads",
    date: "2026-09-26",
    spend: 2840,
    revenue: 13064,
    impressions: 304600,
    clicks: 12980,
    conversions: 518,
    currency: "USD",
  },
  {
    id: "c5",
    name: "Shopping · Core products",
    client: "North Supply",
    platform: "google_ads",
    date: "2026-09-26",
    spend: 2400,
    revenue: 9360,
    impressions: 468600,
    clicks: 9860,
    conversions: 408,
    currency: "USD",
  },
  {
    id: "c6",
    name: "Creator stories · Reach",
    client: "Forma Studio",
    platform: "tiktok_business",
    date: "2026-09-25",
    spend: 1609.89,
    revenue: 6013,
    impressions: 285400,
    clicks: 8200,
    conversions: 224,
    currency: "USD",
  },
  {
    id: "c7",
    name: "Weekend edit · Retargeting",
    client: "Goodkind",
    platform: "meta_ads",
    date: "2026-09-25",
    spend: 2697.64,
    revenue: 9454,
    impressions: 245700,
    clicks: 9460,
    conversions: 378,
    currency: "USD",
  },
  {
    id: "c8",
    name: "Performance Max · Seasonal",
    client: "Forma Studio",
    platform: "google_ads",
    date: "2026-09-24",
    spend: 1602.97,
    revenue: 7030,
    impressions: 182300,
    clicks: 8740,
    conversions: 244,
    currency: "USD",
  },
];
export const sampleClients = [
  {
    id: "north",
    name: "North Supply",
    initials: "NS",
    color: "#c9dbac",
    sector: "Lifestyle & retail",
    email: "team@north.example.test",
    accounts: 5,
    sources: 3,
    rows: 12480,
    state: "Ready to report",
  },
  {
    id: "forma",
    name: "Forma Studio",
    initials: "FS",
    color: "#b8cbe6",
    sector: "Design & home",
    email: "hello@forma.example.test",
    accounts: 4,
    sources: 3,
    rows: 8240,
    state: "Ready to report",
  },
  {
    id: "goodkind",
    name: "Goodkind",
    initials: "GK",
    color: "#d6b7c9",
    sector: "Health & wellness",
    email: "team@goodkind.example.test",
    accounts: 3,
    sources: 1,
    rows: 4140,
    state: "Ready to report",
  },
];

export function downloadSampleCsv(rows: CampaignRow[]) {
  const escape = (value: string | number) =>
    `"${String(value).replaceAll('"', '""')}"`;
  const columns: (keyof CampaignRow)[] = [
    "date",
    "name",
    "client",
    "platform",
    "currency",
    "spend",
    "revenue",
    "impressions",
    "clicks",
    "conversions",
  ];
  const csv = [
    columns,
    ...rows.map((row) => columns.map((column) => row[column])),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "monstera-sample-metrics.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
