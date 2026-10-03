import type { WorkCategory } from "@prisma/client";

export const ONBOARDING_PROVIDERS = [
  { id: "tiktok_business", name: "TikTok Ads", description: "Campaign performance and advertiser accounts", mark: "♪" },
  { id: "meta_ads", name: "Meta Ads", description: "Facebook and Instagram advertising", mark: "∞" },
  { id: "google_ads", name: "Google Ads", description: "Search, display and campaign results", mark: "G" },
  { id: "shopee", name: "Shopee", description: "Shop orders and revenue", mark: "S" },
] as const;
export type OnboardingProvider = typeof ONBOARDING_PROVIDERS[number]["id"];
export const WORK_ROLES: { id: WorkCategory; name: string; description: string }[] = [
  { id: "BUSINESS_OWNER", name: "Business owner", description: "A clear view of your business, without the busywork." },
  { id: "GROWTH_MARKETER", name: "Growth marketer", description: "Campaign results, reporting and your next move." },
  { id: "AGENCY_CONSULTANT", name: "Agency / consultant", description: "Connected client data. Reports ready to share." },
  { id: "ECOMMERCE_SELLER", name: "E-commerce seller", description: "Your advertising and shop performance, together." },
  { id: "OPERATIONS_ANALYST", name: "Operations / analyst", description: "Reliable data, fewer manual steps." },
  { id: "OTHER", name: "Other", description: "Start with your tools. We’ll adapt from there." },
];
