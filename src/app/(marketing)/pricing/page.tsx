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
    Search,
    Shield,
    SlidersHorizontal,
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
    free: ComparisonValue;
    starter: ComparisonValue;
    professional: ComparisonValue;
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
            name: "free",
            label: "Start",
            eyebrow: isVnd ? "Dùng thử" : "Trial",
            description: isVnd
                ? "Một nguồn, một tài khoản quảng cáo, đồng bộ khi bạn bấm, Google Sheets. Không phải gói trả phí."
                : "One source, one ad account, on-demand sync, Google Sheets. This is the trial, not a paid plan.",
            features: [
                { icon: Shield, text: isVnd ? "1 workspace · 1 nguồn · 1 tài khoản" : "1 workspace · 1 source · 1 ad account" },
                { icon: FileSpreadsheet, text: isVnd ? "Chỉ Google Sheets" : "Sheets only — no Looker Studio" },
                { icon: Clock, text: isVnd ? "Đồng bộ khi bạn bấm" : "On-demand sync only" },
                { icon: Database, text: isVnd ? "Lookback / lịch sử truy vấn 14 ngày" : "14-day lookback / query history" },
            ],
        },
        {
            name: "starter",
            label: "Studio",
            description: isVnd
                ? "Kho + Sheets + Looker Studio trong cùng workspace. Không phụ phí đích đến."
                : "Warehouse + Sheets + Looker Studio in one workspace. No destination fee.",
            features: [
                { icon: Shield, text: isVnd ? "1 workspace · 2 nguồn · 6 tài khoản" : "1 workspace · 2 sources · 6 ad accounts" },
                { icon: Users, text: isVnd ? "Thành viên không giới hạn" : "Unlimited seats" },
                { icon: Clock, text: isVnd ? "Đồng bộ hàng ngày + khi bấm" : "Daily scheduled sync + on-demand" },
                { icon: Database, text: isVnd ? "Kho + Sheets + Looker Studio" : "Warehouse + Sheets + Looker Studio included" },
            ],
        },
        {
            name: "professional",
            label: "Agency",
            eyebrow: isVnd ? "Phù hợp cho agency" : "Best for agencies",
            description: isVnd
                ? "Nhiều workspace, bốn nguồn chứng nhận, CSV và REST API."
                : "Multiple workspaces, four certified sources, CSV and REST API.",
            features: [
                { icon: SlidersHorizontal, text: isVnd ? "3 workspace · 4 nguồn · 15 tài khoản / workspace" : "3 workspaces · 4 sources · 15 accounts / workspace" },
                { icon: Users, text: isVnd ? "Thành viên không giới hạn" : "Unlimited seats" },
                { icon: Clock, text: isVnd ? "Đồng bộ hàng ngày + khi bấm" : "Daily + on-demand" },
                { icon: Zap, text: isVnd ? "CSV + REST API · kho + Sheets + Looker" : "CSV + REST API · warehouse + Sheets + Looker" },
            ],
            highlighted: true,
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
                { name: "Meta Ads", free: true, starter: true, professional: true },
                { name: "Google Ads", free: true, starter: true, professional: true },
                { name: "TikTok Ads", free: false, starter: true, professional: true },
                { name: "Shopee", free: false, starter: false, professional: true },
                { name: "Google Sheets add-on", free: true, starter: true, professional: true },
                { name: "Looker Studio connector", free: false, starter: true, professional: true },
                { name: isVnd ? "Phụ phí đích đến thứ hai" : "Second-destination fee", free: false, starter: false, professional: false },
            ],
        },
        {
            title: isVnd ? "Dung lượng workspace" : "Workspace capacity",
            icon: Database,
            description: isVnd
                ? "Giới hạn được lấy trực tiếp từ cấu hình gói hiện tại."
                : "Limits shown directly from the current plan configuration.",
            features: [
                { name: isVnd ? "Workspace" : "Workspaces", free: formatNumber(PLAN_LIMITS.free.maxWorkspaces), starter: formatNumber(PLAN_LIMITS.starter.maxWorkspaces), professional: formatNumber(PLAN_LIMITS.professional.maxWorkspaces) },
                { name: isVnd ? "Nguồn (nền tảng)" : "Sources (platforms)", free: formatNumber(PLAN_LIMITS.free.maxSourceProviders), starter: formatNumber(PLAN_LIMITS.starter.maxSourceProviders), professional: formatNumber(PLAN_LIMITS.professional.maxSourceProviders) },
                { name: isVnd ? "Tài khoản quảng cáo / workspace" : "Ad accounts / workspace", free: formatNumber(PLAN_LIMITS.free.maxConnections), starter: formatNumber(PLAN_LIMITS.starter.maxConnections), professional: formatNumber(PLAN_LIMITS.professional.maxConnections) },
                { name: isVnd ? "Thành viên" : "Team seats", free: formatNumber(PLAN_LIMITS.free.maxSeats), starter: isVnd ? "Không giới hạn" : "Unlimited", professional: isVnd ? "Không giới hạn" : "Unlimited" },
                { name: isVnd ? "Khoảng ngày mỗi truy vấn" : "Date range per query", free: `${PLAN_LIMITS.free.maxHistoryDays} ${isVnd ? "ngày" : "days"}`, starter: `${PLAN_LIMITS.starter.explorerMaxDateRangeDays} ${isVnd ? "ngày" : "days"}`, professional: `${PLAN_LIMITS.professional.explorerMaxDateRangeDays} ${isVnd ? "ngày" : "days"}` },
                { name: isVnd ? "CSV + REST API" : "CSV + REST API", free: false, starter: false, professional: true },
            ],
        },
        {
            title: isVnd ? "Vận hành & kiểm soát" : "Operations & control",
            icon: FileSpreadsheet,
            description: isVnd
                ? "Khả năng vận hành có thể kiểm tra trong console hiện tại."
                : "Operational capabilities available in the current console.",
            features: [
                { name: isVnd ? "Nhịp đồng bộ" : "Sync cadence", free: PLAN_LIMITS.free.syncLabel, starter: PLAN_LIMITS.starter.syncLabel, professional: PLAN_LIMITS.professional.syncLabel },
                { name: isVnd ? "Cô lập dữ liệu theo workspace" : "Workspace-scoped data isolation", free: true, starter: true, professional: true },
                { name: isVnd ? "Kho token được mã hóa" : "Encrypted credential vault", free: true, starter: true, professional: true },
                { name: isVnd ? "Lịch sử đồng bộ trong console" : "In-console sync history", free: true, starter: true, professional: true },
                { name: isVnd ? "Kích hoạt gói có xác nhận" : "Operator-confirmed activation", free: true, starter: true, professional: true },
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
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-200/[0.06] px-3 py-1 font-mono text-[11px] font-medium text-amber-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        <span>{isVnd ? "Bản nháp — chưa thu phí" : "Draft catalog — not live billing"}</span>
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
                            ? "Bản nháp catalog Start / Studio / Agency. Không thay giá Paddle (USD) hay PayOS/VietQR (VND) production. Checkout công khai vẫn là yêu cầu quyền pilot. VN thấy số VND; ngoài VN thấy USD. Google đổi tên Looker Studio thành Data Studio ngày 16/04/2026 — sản phẩm vẫn dùng Looker Studio™."
                            : "Draft Start / Studio / Agency catalog. This PR does not change production Paddle (USD) or PayOS/VietQR (VND) prices. Public checkout remains Request pilot access. VN visitors see VND; everyone else sees USD. Google rebranded Looker Studio to Data Studio on 16 Apr 2026 — in-product copy still says Looker Studio™."}
                    </p>
                </div>

                <section className="grid w-full grid-cols-1 items-stretch gap-6 md:grid-cols-3" aria-label="Pricing plans">
                    {planCards.map((plan) => {
                        const price = formatPlanPrice(plan.name, currency, isAnnual);
                        const isFree = plan.name === "free";
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
                                            <span className="text-4xl font-bold tracking-tight text-ink lg:text-5xl">{isFree ? (isVnd ? "0 đ" : "Free") : price.formatted}</span>
                                            {isFree ? null : <span className="text-xs font-normal text-ink-mute">{isVnd ? "/ tháng" : "/ mo"}</span>}
                                        </div>
                                        <p className="mt-1 min-h-4 font-mono text-[10px] text-neutral-500">{isFree ? (isVnd ? "Dùng thử — không phải gói trả phí" : "Trial — not a paid plan") : isAnnual ? formatAnnualTotal(price.amount, currency) : isVnd ? "Thanh toán theo tháng" : "Billed monthly"}</p>
                                    </div>
                                    <p className="mb-6 min-h-[52px] text-xs leading-relaxed text-ink-mute">{plan.description}</p>
                                    <ul className="mb-8 space-y-3 border-t border-line pt-5 text-xs text-neutral-300">
                                        {plan.features.map((feature) => {
                                            const FeatureIcon = feature.icon;
                                            return <li key={feature.text} className="flex items-start gap-2.5"><FeatureIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-mute" /><span className="leading-relaxed">{feature.text}</span></li>;
                                        })}
                                    </ul>
                                </div>
                                <Link href={plan.name === "free" ? "/register" : `/support?pilot=1&plan=${plan.name}`} className={cn("flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-xs font-semibold transition-colors", plan.highlighted ? "bg-white text-black hover:bg-neutral-200" : "border border-line bg-canvas text-ink hover:bg-white/[0.04]")}>
                                    <span>{plan.name === "free" ? (isVnd ? "Tạo tài khoản miễn phí" : "Create free account") : (isVnd ? "Yêu cầu quyền truy cập pilot" : "Request pilot access")}</span>
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                            </article>
                        );
                    })}
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
                        <div className="col-span-2 text-center text-[10px] font-semibold sm:text-xs">Start</div>
                        <div className="col-span-2 text-center text-[10px] font-semibold sm:text-xs">Studio</div>
                        <div className="col-span-2 text-center text-[10px] font-semibold text-white sm:text-xs">Agency</div>
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
                                                <div className="col-span-2 flex items-center justify-center text-center"><ComparisonCell value={feature.free} /></div>
                                                <div className="col-span-2 flex items-center justify-center text-center"><ComparisonCell value={feature.starter} /></div>
                                                <div className="col-span-2 flex items-center justify-center text-center"><ComparisonCell value={feature.professional} emphasized /></div>
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
