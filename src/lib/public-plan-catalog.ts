import { getPlanLimits, PLAN_PRICING, PLAN_VND_ANNUAL_TOTALS } from "./plan-config";

export type BillingCycle = "monthly" | "annual";
export type BillingCurrency = "VND" | "USD";
export type PricingLanguage = "en" | "vi";
export const PUBLIC_PLAN_IDS = ["professional", "enterprise"] as const;
export type PublicPlanId = (typeof PUBLIC_PLAN_IDS)[number];

/** Public offers. Legacy plan prices remain internal; Enterprise is quoted. */
export const PUBLIC_PLANS = {
  professional: { name: "Agency Pro", description: "A shared home for your clients’ performance data." },
  enterprise: { name: "Enterprise", description: "A reporting setup shaped around your agency." },
} as const;

export function planName(plan: string): string {
  if (["professional", "agency", "pro"].includes(plan)) return "Agency Pro";
  if (plan === "free") return "Free";
  if (plan === "starter") return "Studio (legacy)";
  if (plan === "pilot") return "Pilot";
  return plan === "enterprise" ? "Enterprise" : plan;
}

export function agencyProAmount(cycle: BillingCycle): number {
  return cycle === "annual" ? PLAN_VND_ANNUAL_TOTALS.professional! : PLAN_PRICING.professional.vndMonthly;
}

export function publicPlanPrice(plan: PublicPlanId, currency: BillingCurrency, cycle: BillingCycle, language: PricingLanguage = "en") {
  const vi = language === "vi";
  if (plan === "enterprise") return { amount: null, formatted: vi ? "Liên hệ" : "Let’s talk", suffix: "", detail: vi ? "Báo giá theo nhu cầu" : "Quoted to your requirements" };
  if (currency === "USD") {
    // Preserve the existing public USD contact-sales rate; there is no USD checkout.
    const amount = cycle === "annual" ? 64 : 79;
    return { amount, formatted: `$${amount}`, suffix: vi ? "/ tháng" : "/ month", detail: cycle === "annual" ? `$${amount * 12} ${vi ? "mỗi năm · liên hệ tư vấn" : "per year · contact sales"}` : vi ? "Liên hệ tư vấn thanh toán USD" : "Contact sales for USD billing" };
  }
  const amount = agencyProAmount(cycle);
  return {
    amount,
    formatted: `${amount.toLocaleString("vi-VN")} ₫`,
    suffix: cycle === "annual" ? (vi ? "/ năm" : "/ year") : (vi ? "/ tháng" : "/ month"),
    detail: vi ? `Thanh toán một lần cho ${cycle === "annual" ? "365" : "30"} ngày` : cycle === "annual" ? "One payment for 365 days" : "One payment for 30 days",
  };
}

export function publicPlanFeatures(plan: PublicPlanId, language: PricingLanguage = "en"): string[] {
  const limits = getPlanLimits("professional");
  if (language === "vi") return plan === "enterprise" ? ["Thống nhất phạm vi tài khoản và workspace", "Phạm vi triển khai và hỗ trợ theo nhu cầu", "Đánh giá yêu cầu kho dữ liệu và tích hợp", "Trao đổi trực tiếp với nhà sáng lập"] : [
    `${limits.maxConnections} kết nối nguồn mỗi workspace`,
    `${limits.maxWorkspaces} workspace sở hữu · ${limits.maxSeats} thành viên mỗi workspace`,
    `${limits.maxQueriesPerMonth.toLocaleString("vi-VN")} lượt làm mới mỗi tháng`,
    `Tra cứu tối đa ${limits.explorerMaxDateRangeDays} ngày mỗi truy vấn`,
    "Google Sheets, Looker Studio, CSV và API",
    "Theo dõi nguồn và khắc phục lỗi nhập dữ liệu",
  ];
  if (plan === "enterprise") return ["Account and workspace scope agreed together", "Custom implementation and support scope", "Warehouse and integration requirements review", "Talk directly with the founder"];
  return [
    `${limits.maxConnections} source connections per workspace`,
    `${limits.maxWorkspaces} owned workspaces · ${limits.maxSeats} seats per workspace`,
    `${limits.maxQueriesPerMonth.toLocaleString("en-US")} refreshes per month`,
    `Explore up to ${limits.explorerMaxDateRangeDays} days per query`,
    "Google Sheets, Looker Studio, CSV and API",
    "Source health and import recovery tools",
  ];
}

/** Existing PayOS terms are prepaid. A different paid tier needs a reviewed quote. */
export function canPurchaseAgencyPro(plan: string, status: string, billing: { provider?: string | null; endsAt?: string | Date | null } = {}): boolean {
  if (status === "SUSPENDED" || !["free", "professional", "pilot"].includes(plan)) return false;
  // Do not replace another provider's subscription or discard an undated legacy entitlement.
  if (billing.provider && billing.provider !== "vietqr_domestic") return false;
  if (plan === "free" || status === "PILOT") return true;
  return !!billing.endsAt && Number.isFinite(new Date(billing.endsAt).getTime());
}
