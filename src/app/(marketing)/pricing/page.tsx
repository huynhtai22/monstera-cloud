"use client";

import Link from "next/link";
import {
    ArrowRight,
    Check,
    Clock,
    Database,
    FileSpreadsheet,
    Globe,
    Info,
    Layers,
    Search,
    Shield,
    SlidersHorizontal,
    Sparkles,
    Users,
    Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatPlanPrice, PLAN_LIMITS, type PlanName } from "@/lib/plan-config";
import { cn } from "@/lib/utils";

type Currency = "USD" | "VND";
type ComparisonValue = boolean | string;

interface ComparisonFeature {
    name: string;
    starter: ComparisonValue;
    professional: ComparisonValue;
    enterprise: ComparisonValue;
}

interface ComparisonCategory {
    title: string;
    description: string;
    icon: typeof Globe;
    features: ComparisonFeature[];
}

interface PlanCard {
    name: PlanName;
    label: string;
    eyebrow?: string;
    description: string;
    features: Array<{ icon: typeof Globe; text: string }>;
    highlighted?: boolean;
}

function formatNumber(value: number) {
    if (!Number.isFinite(value)) return "Unlimited";
    return new Intl.NumberFormat("en-US").format(value);
}

function formatAnnualTotal(amount: number, currency: Currency) {
    const total = amount * 12;
    if (currency === "VND") {
        return `${new Intl.NumberFormat("vi-VN").format(total)} đ / năm`;
    }
    return `$${new Intl.NumberFormat("en-US").format(total)} / year`;
}

function ComparisonCell({ value, emphasized = false }: { value: ComparisonValue; emphasized?: boolean }) {
    if (typeof value === "boolean") {
        return value ? (
            <Check className={cn("h-3.5 w-3.5", emphasized ? "text-white" : "text-neutral-300")} />
        ) : (
            <span className="font-light text-neutral-700">—</span>
        );
    }

    return (
        <span className={cn("font-mono text-[10px] sm:text-[11px]", emphasized ? "font-medium text-white" : "text-neutral-300")}>
            {value}
        </span>
    );
}

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);
    const [currency, setCurrency] = useState<Currency>("USD");
    const [searchQuery, setSearchQuery] = useState("");
    const isVnd = currency === "VND";

    useEffect(() => {
        let active = true;

        async function resolveCurrency() {
            try {
                const response = await fetch("/api/geo");
                if (!response.ok) return;
                const geo = await response.json() as { currency?: string; country?: string; isVietnam?: boolean };
                if (!active) return;
                setCurrency(geo.currency === "VND" || geo.isVietnam || geo.country === "VN" ? "VND" : "USD");
            } catch {
                // USD remains the safe fallback when location detection is unavailable.
            }
        }

        void resolveCurrency();
        return () => {
            active = false;
        };
    }, []);

    const planCards = useMemo<PlanCard[]>(() => [
        {
            name: "starter",
            label: "Starter",
            description: isVnd
                ? "Cho media buyer cá nhân và đội ngũ nhỏ cần một luồng báo cáo ổn định."
                : "For solo media buyers and small teams that need a dependable reporting workflow.",
            features: [
                { icon: Shield, text: isVnd ? "5 kết nối dữ liệu" : "5 data connections" },
                { icon: Layers, text: isVnd ? "5 pipeline · 1 thành viên" : "5 pipelines · 1 seat" },
                { icon: Zap, text: isVnd ? "500 truy vấn hoặc làm mới / tháng" : "500 queries or refreshes / month" },
                { icon: Clock, text: isVnd ? "Nhịp đồng bộ hàng ngày" : "Daily sync cadence" },
                { icon: Database, text: isVnd ? "Khoảng ngày 90 ngày · 1.000 dòng / truy vấn" : "90-day query range · 1,000 rows / query" },
            ],
        },
        {
            name: "professional",
            label: "Professional",
            eyebrow: isVnd ? "Phù hợp cho agency" : "Best for agencies",
            description: isVnd
                ? "Cho agency quản lý nhiều thương hiệu, workspace và luồng báo cáo."
                : "For agencies managing multiple brands, workspaces, and reporting flows.",
            features: [
                { icon: SlidersHorizontal, text: isVnd ? "20 kết nối dữ liệu" : "20 data connections" },
                { icon: Users, text: isVnd ? "15 pipeline · 3 thành viên" : "15 pipelines · 3 seats" },
                { icon: Zap, text: isVnd ? "3.000 truy vấn hoặc làm mới / tháng" : "3,000 queries or refreshes / month" },
                { icon: Clock, text: isVnd ? "Làm mới hàng đêm + thủ công" : "Nightly + manual refresh" },
                { icon: Database, text: isVnd ? "Khoảng ngày 365 ngày · 5.000 dòng / truy vấn" : "365-day query range · 5,000 rows / query" },
            ],
            highlighted: true,
        },
        {
            name: "enterprise",
            label: "Enterprise",
            eyebrow: isVnd ? "Triển khai có hỗ trợ" : "Assisted rollout",
            description: isVnd
                ? "Cho đội ngũ cần dung lượng lớn hơn và kế hoạch triển khai được xác nhận trước."
                : "For teams that need higher capacity and a rollout plan confirmed in advance.",
            features: [
                { icon: SlidersHorizontal, text: isVnd ? "100 kết nối dữ liệu" : "100 data connections" },
                { icon: Users, text: isVnd ? "Pipeline không giới hạn · 10 thành viên" : "Unlimited pipelines · 10 seats" },
                { icon: Zap, text: isVnd ? "50.000 truy vấn hoặc làm mới / tháng" : "50,000 queries or refreshes / month" },
                { icon: Clock, text: isVnd ? "Làm mới hàng đêm + thủ công" : "Nightly + manual refresh" },
                { icon: Database, text: isVnd ? "Khoảng ngày 730 ngày · 10.000 dòng / truy vấn" : "730-day query range · 10,000 rows / query" },
            ],
        },
    ], [isVnd]);

    const comparisonCategories = useMemo<ComparisonCategory[]>(() => [
        {
            title: isVnd ? "Nguồn dữ liệu & đích đến" : "Sources & destinations",
            icon: Globe,
            description: isVnd
                ? "Các luồng kết nối hiện có trong sản phẩm. Quyền truy cập nhà cung cấp được xác nhận trong pilot."
                : "Current product workflows. Provider access is confirmed during pilot onboarding.",
            features: [
                { name: "Meta Ads", starter: true, professional: true, enterprise: true },
                { name: "Google Ads", starter: true, professional: true, enterprise: true },
                { name: "TikTok Ads", starter: true, professional: true, enterprise: true },
                { name: "Shopee", starter: true, professional: true, enterprise: true },
                { name: "Google Sheets add-on", starter: true, professional: true, enterprise: true },
                { name: "Looker Studio connector", starter: true, professional: true, enterprise: true },
            ],
        },
        {
            title: isVnd ? "Dung lượng workspace" : "Workspace capacity",
            icon: Database,
            description: isVnd
                ? "Giới hạn được lấy trực tiếp từ cấu hình gói hiện tại."
                : "Limits shown directly from the current plan configuration.",
            features: [
                { name: isVnd ? "Kết nối dữ liệu" : "Data connections", starter: formatNumber(PLAN_LIMITS.starter.maxConnections), professional: formatNumber(PLAN_LIMITS.professional.maxConnections), enterprise: formatNumber(PLAN_LIMITS.enterprise.maxConnections) },
                { name: isVnd ? "Pipeline" : "Pipelines", starter: formatNumber(PLAN_LIMITS.starter.maxPipelines), professional: formatNumber(PLAN_LIMITS.professional.maxPipelines), enterprise: isVnd ? "Không giới hạn" : formatNumber(PLAN_LIMITS.enterprise.maxPipelines) },
                { name: isVnd ? "Thành viên" : "Team seats", starter: formatNumber(PLAN_LIMITS.starter.maxSeats), professional: formatNumber(PLAN_LIMITS.professional.maxSeats), enterprise: formatNumber(PLAN_LIMITS.enterprise.maxSeats) },
                { name: isVnd ? "Truy vấn / làm mới mỗi tháng" : "Monthly queries / refreshes", starter: formatNumber(PLAN_LIMITS.starter.maxQueriesPerMonth), professional: formatNumber(PLAN_LIMITS.professional.maxQueriesPerMonth), enterprise: formatNumber(PLAN_LIMITS.enterprise.maxQueriesPerMonth) },
                { name: isVnd ? "Khoảng ngày mỗi truy vấn" : "Date range per query", starter: `${PLAN_LIMITS.starter.explorerMaxDateRangeDays} ${isVnd ? "ngày" : "days"}`, professional: `${PLAN_LIMITS.professional.explorerMaxDateRangeDays} ${isVnd ? "ngày" : "days"}`, enterprise: `${PLAN_LIMITS.enterprise.explorerMaxDateRangeDays} ${isVnd ? "ngày" : "days"}` },
                { name: isVnd ? "Số dòng mỗi truy vấn" : "Rows per query", starter: formatNumber(PLAN_LIMITS.starter.explorerMaxRowsPerQuery), professional: formatNumber(PLAN_LIMITS.professional.explorerMaxRowsPerQuery), enterprise: formatNumber(PLAN_LIMITS.enterprise.explorerMaxRowsPerQuery) },
            ],
        },
        {
            title: isVnd ? "Vận hành & kiểm soát" : "Operations & control",
            icon: FileSpreadsheet,
            description: isVnd
                ? "Khả năng vận hành có thể kiểm tra trong console hiện tại."
                : "Operational capabilities available in the current console.",
            features: [
                { name: isVnd ? "Nhịp đồng bộ" : "Sync cadence", starter: PLAN_LIMITS.starter.syncLabel, professional: PLAN_LIMITS.professional.syncLabel, enterprise: PLAN_LIMITS.enterprise.syncLabel },
                { name: isVnd ? "Cô lập dữ liệu theo workspace" : "Workspace-scoped data isolation", starter: true, professional: true, enterprise: true },
                { name: isVnd ? "Kho token được mã hóa" : "Encrypted credential vault", starter: true, professional: true, enterprise: true },
                { name: isVnd ? "Lịch sử đồng bộ trong console" : "In-console sync history", starter: true, professional: true, enterprise: true },
                { name: isVnd ? "Kích hoạt gói có xác nhận" : "Operator-confirmed activation", starter: true, professional: true, enterprise: true },
            ],
        },
    ], [isVnd]);

    const filteredCategories = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return comparisonCategories;
        return comparisonCategories
            .map((category) => ({ ...category, features: category.features.filter((feature) => feature.name.toLowerCase().includes(query)) }))
            .filter((category) => category.features.length > 0);
    }, [comparisonCategories, searchQuery]);

    return (
        <div className="min-h-screen bg-canvas pb-24 pt-20 font-sans text-ink antialiased">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
                <header className="mx-auto mb-9 max-w-3xl pt-6 text-center">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[11px] font-medium text-ink-mute">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span>{isVnd ? "Giá rõ ràng theo dung lượng" : "Predictable, capacity-based pricing"}</span>
                    </div>
                    <h1 className="text-4xl font-semibold leading-[1.12] tracking-tight text-ink sm:text-5xl">
                        {isVnd ? (
                            <>Mở rộng báo cáo.<br /><span className="text-neutral-400">Giữ dữ liệu trong tầm kiểm soát.</span></>
                        ) : (
                            <>Scale your reporting.<br /><span className="text-neutral-400">Keep your data stack controlled.</span></>
                        )}
                    </h1>
                    <p className="mx-auto mt-4 max-w-2xl text-sm font-normal leading-relaxed text-ink-mute sm:text-base">
                        {isVnd
                            ? "Một workspace thống nhất cho dữ liệu quảng cáo, Google Sheets và Looker Studio—với giới hạn rõ ràng trước khi triển khai."
                            : "One workspace for advertising data, Google Sheets, and Looker Studio—with clear limits before you roll it out."}
                    </p>
                </header>

                <div className="mb-8 flex items-center justify-center">
                    <div className="inline-flex rounded-full border border-line bg-panel p-1 shadow-xs" aria-label="Billing period">
                        <button type="button" aria-pressed={!isAnnual} onClick={() => setIsAnnual(false)} className={cn("rounded-full px-4 py-1.5 text-xs transition-all duration-150", !isAnnual ? "bg-white font-semibold text-black shadow-xs" : "font-medium text-ink-mute hover:text-ink")}>{isVnd ? "Theo tháng" : "Monthly"}</button>
                        <button type="button" aria-pressed={isAnnual} onClick={() => setIsAnnual(true)} className={cn("flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs transition-all duration-150", isAnnual ? "bg-white font-semibold text-black shadow-xs" : "font-medium text-ink-mute hover:text-ink")}>
                            <span>{isVnd ? "Theo năm" : "Yearly"}</span>
                            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-tight", isAnnual ? "bg-black text-white" : "border border-neutral-700 bg-neutral-800 text-neutral-300")}>{isVnd ? "tiết kiệm đến 20%" : "save up to 20%"}</span>
                        </button>
                    </div>
                </div>

                <div className="mx-auto mb-9 flex max-w-3xl items-start gap-3 rounded-lg border border-amber-300/15 bg-amber-200/[0.04] px-4 py-3 text-left">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-200/70" />
                    <p className="text-xs leading-relaxed text-neutral-400">
                        {isVnd
                            ? "Giá hiển thị dùng để lập kế hoạch. Trong giai đoạn private pilot, đội ngũ Monstera xác nhận quyền truy cập nhà cung cấp và kích hoạt gói—trang này không tự thay đổi thuê bao của bạn."
                            : "Prices are shown for planning. During private pilot, Monstera confirms provider access and activates the plan with you—this page does not change your subscription automatically."}
                    </p>
                </div>

                <section className="grid w-full grid-cols-1 items-stretch gap-6 md:grid-cols-3" aria-label="Pricing plans">
                    {planCards.map((plan) => {
                        const price = formatPlanPrice(plan.name, currency, isAnnual);
                        return (
                            <article key={plan.name} className={cn("relative flex flex-col justify-between rounded-xl border bg-panel p-7 transition-all duration-200", plan.highlighted ? "border-white/25 shadow-xl shadow-black/20 ring-1 ring-white/10 md:-translate-y-2" : "border-line hover:border-white/20")}>
                                {plan.highlighted ? <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" /> : null}
                                <div>
                                    <div className="mb-4 flex min-h-6 flex-wrap items-center gap-2">
                                        <h2 className="text-sm font-medium tracking-tight text-ink">{plan.label}</h2>
                                        {plan.eyebrow ? <span className="rounded border border-line bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-neutral-300">{plan.eyebrow}</span> : null}
                                    </div>
                                    <div className="mb-2 min-h-[54px]">
                                        <div className="flex flex-wrap items-baseline gap-x-1.5">
                                            <span className="text-4xl font-bold tracking-tight text-ink lg:text-5xl">{price.formatted}</span>
                                            <span className="text-xs font-normal text-ink-mute">{isVnd ? "/ tháng" : "/ mo"}</span>
                                        </div>
                                        <p className="mt-1 min-h-4 font-mono text-[10px] text-neutral-500">{isAnnual ? formatAnnualTotal(price.amount, currency) : isVnd ? "Thanh toán theo tháng" : "Billed monthly"}</p>
                                    </div>
                                    <p className="mb-6 min-h-[52px] text-xs leading-relaxed text-ink-mute">{plan.description}</p>
                                    <ul className="mb-8 space-y-3 border-t border-line pt-5 text-xs text-neutral-300">
                                        {plan.features.map((feature) => {
                                            const FeatureIcon = feature.icon;
                                            return <li key={feature.text} className="flex items-start gap-2.5"><FeatureIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-mute" /><span className="leading-relaxed">{feature.text}</span></li>;
                                        })}
                                    </ul>
                                </div>
                                <Link href={`/support?pilot=1&plan=${plan.name}`} className={cn("flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-xs font-semibold transition-colors", plan.highlighted ? "bg-white text-black hover:bg-neutral-200" : "border border-line bg-canvas text-ink hover:bg-white/[0.04]")}>
                                    <span>{plan.name === "enterprise" ? (isVnd ? "Lập kế hoạch triển khai" : "Plan a rollout") : (isVnd ? "Yêu cầu quyền truy cập pilot" : "Request pilot access")}</span>
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                            </article>
                        );
                    })}
                </section>

                <section className="mt-8 flex flex-col gap-4 rounded-xl border border-line bg-panel px-5 py-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Free plan">
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-md border border-line bg-canvas p-2"><Sparkles className="h-4 w-4 text-neutral-300" /></div>
                        <div>
                            <h2 className="text-sm font-semibold text-ink">{isVnd ? "Bắt đầu với gói Free" : "Start with Free"}</h2>
                            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-mute">{isVnd ? "2 kết nối, 2 pipeline, 1 thành viên, 100 truy vấn hoặc làm mới mỗi tháng và lịch sử nguồn dữ liệu 14 ngày." : "2 connections, 2 pipelines, 1 seat, 100 queries or refreshes per month, and 14 days of source history."}</p>
                        </div>
                    </div>
                    <Link href="/register" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-line bg-canvas px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-white/[0.04]">{isVnd ? "Tạo tài khoản miễn phí" : "Create free account"}<ArrowRight className="h-3.5 w-3.5" /></Link>
                </section>

                <section className="mt-24 w-full" aria-labelledby="comparison-heading">
                    <div className="flex flex-col items-start justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-end">
                        <div>
                            <h2 id="comparison-heading" className="text-xl font-bold tracking-tight text-ink">{isVnd ? "So sánh chi tiết" : "Compare the details"}</h2>
                            <p className="mt-1 text-xs text-ink-mute">{isVnd ? "Giá trị cấu hình hiện tại, không phải hạn mức ước tính." : "Current configured values—not estimated allowances."}</p>
                        </div>
                        <label className="relative w-full sm:w-64">
                            <span className="sr-only">{isVnd ? "Tìm tính năng" : "Search features"}</span>
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
                            <input type="search" placeholder={isVnd ? "Tìm tính năng..." : "Search features..."} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="w-full rounded-md border border-line bg-panel py-2 pl-9 pr-3 text-xs text-ink placeholder:text-ink-mute/70 focus:border-white/25 focus:outline-none" />
                        </label>
                    </div>

                    <div className="sticky top-13 z-20 grid grid-cols-12 border-b border-line bg-canvas/95 py-3.5 text-sm font-semibold text-ink backdrop-blur-md">
                        <div className="col-span-6 font-mono text-xs font-medium uppercase tracking-wider text-ink-mute">{isVnd ? "Tính năng" : "Feature"}</div>
                        <div className="col-span-2 text-center text-[10px] font-semibold sm:text-xs">Starter</div>
                        <div className="col-span-2 text-center text-[10px] font-semibold text-white sm:text-xs">Pro</div>
                        <div className="col-span-2 text-center text-[10px] font-semibold sm:text-xs">Enterprise</div>
                    </div>

                    <div className="divide-y divide-line/60">
                        {filteredCategories.map((category) => {
                            const CategoryIcon = category.icon;
                            return (
                                <div key={category.title} className="pb-4 pt-6">
                                    <div className="mb-1 flex items-center gap-2"><CategoryIcon className="h-4 w-4 text-ink-mute" /><h3 className="text-sm font-semibold text-ink">{category.title}</h3></div>
                                    <p className="mb-4 max-w-2xl text-xs leading-relaxed text-ink-mute">{category.description}</p>
                                    <div className="space-y-0.5">
                                        {category.features.map((feature) => (
                                            <div key={feature.name} className="grid grid-cols-12 items-center rounded-md px-2 py-3 text-xs transition-colors hover:bg-white/[0.03]">
                                                <div className="col-span-6 pr-3 font-normal text-neutral-300">{feature.name}</div>
                                                <div className="col-span-2 flex items-center justify-center text-center"><ComparisonCell value={feature.starter} /></div>
                                                <div className="col-span-2 flex items-center justify-center text-center"><ComparisonCell value={feature.professional} emphasized /></div>
                                                <div className="col-span-2 flex items-center justify-center text-center"><ComparisonCell value={feature.enterprise} /></div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        {filteredCategories.length === 0 ? <div className="py-12 text-center text-sm text-ink-mute">{isVnd ? "Không tìm thấy tính năng phù hợp." : "No matching features found."}</div> : null}
                    </div>
                </section>

                <section className="mt-14 flex w-full flex-col items-center justify-between gap-4 rounded-xl border border-line bg-panel p-6 text-center sm:flex-row sm:text-left">
                    <div>
                        <h2 className="text-sm font-semibold text-ink">{isVnd ? "Bạn cần xác nhận cấu hình pilot?" : "Need to confirm a pilot setup?"}</h2>
                        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-mute">{isVnd ? "Cho chúng tôi biết nguồn dữ liệu, đích đến và số workspace. Chúng tôi sẽ xác nhận quyền truy cập connector và dung lượng phù hợp trước khi kích hoạt." : "Tell us your sources, destinations, and workspace count. We’ll confirm connector access and the right capacity before activation."}</p>
                    </div>
                    <Link href="/support?pilot=1" className="inline-flex shrink-0 items-center gap-2 rounded-md border border-line bg-canvas px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-white/[0.04]">{isVnd ? "Trao đổi về pilot" : "Discuss your pilot"}<ArrowRight className="h-3.5 w-3.5" /></Link>
                </section>
            </div>
        </div>
    );
}
