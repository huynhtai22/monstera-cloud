"use client";

import Link from "next/link";
import {
    Check,
    Lock,
    ShieldCheck,
    Layers,
    Database,
    FileSpreadsheet,
    Clock,
    Users,
    Zap,
    Globe,
    Cpu,
    Headphones,
    Coins,
    SlidersHorizontal,
    Workflow,
    Search,
    QrCode,
} from "lucide-react";
import { VietQrModal } from "@/components/pricing/VietQrModal";
import { Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { metaPixelCustom } from "@/lib/meta-pixel";
import { PLAN_PRICING, PLAN_VND_ANNUAL_TOTALS } from "@/lib/plan-config";
import { cn } from "@/lib/utils";

function PricingPageContent() {
    const searchParams = useSearchParams();
    const workspaceId = searchParams.get("workspaceId") || undefined;
    const [isAnnual, setIsAnnual] = useState(false);
    const [payCurrency, setPayCurrency] = useState<"VND" | "USD">("USD");
    const [searchQuery, setSearchQuery] = useState("");

    // VietQR Modal State
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const [selectedQrPlan, setSelectedQrPlan] = useState<{
        name: "professional" | "enterprise";
        displayName: string;
        amount: number;
    }>({ name: "professional", displayName: "Agency Pro", amount: PLAN_PRICING.professional.vndMonthly });

    useEffect(() => {
        let isMounted = true;
        async function detectGeo() {
            try {
                const res = await fetch("/api/geo");
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted) {
                        if (data?.isVietnam || data?.country === "VN") {
                            setPayCurrency("VND");
                        } else {
                            setPayCurrency("USD");
                        }
                    }
                }
            } catch {
                // Fallback gracefully
            }
        }
        detectGeo();
        return () => {
            isMounted = false;
        };
    }, []);

    const openVietQr = (planKey: "professional" | "enterprise", planDisplayName: string) => {
        const effectiveAnnual = isAnnual;
        let amount = PLAN_PRICING.professional.vndMonthly;
        if (planKey === "professional") {
            amount = effectiveAnnual
                ? PLAN_VND_ANNUAL_TOTALS.professional!
                : PLAN_PRICING.professional.vndMonthly;
        }

        setSelectedQrPlan({
            name: planKey,
            displayName: planDisplayName,
            amount,
        });
        setQrModalOpen(true);

        metaPixelCustom("MC_VietQR_Modal_Opened", {
            plan: planKey,
            billing_cycle: effectiveAnnual ? "annual" : "monthly",
            amount_vnd: amount,
        });
    };

    const proPricing = {
        amountFormatted: payCurrency === "VND" ? (isAnnual ? "14.900.000" : "1.490.000") : isAnnual ? "$64" : "$79",
        currencySymbol: payCurrency === "VND" ? "đ" : "",
        unit: payCurrency === "VND" ? (isAnnual ? "/ năm" : "/ tháng") : "/ mo",
    };

    const enterprisePricing = {
        amountFormatted: payCurrency === "VND" ? "Liên hệ" : "Custom",
        currencySymbol: "",
        unit: "",
    };

    const comparisonCategories = useMemo(() => [
        {
            title: payCurrency === "VND" ? "Kênh quảng cáo & Thu thập dữ liệu" : "Data Ingestion & Ad Channels",
            icon: Globe,
            description: payCurrency === "VND" ? "Các kết nối đang được kích hoạt theo phạm vi pilot" : "Integrations available according to the current pilot scope",
            features: [
                { name: "Meta Ads (Facebook & Instagram)", pro: true, enterprise: true },
                { name: "TikTok Ads & TikTok Shop", pro: true, enterprise: true },
                { name: "Google Ads (Search & PMax)", pro: true, enterprise: true },
                { name: "Shopee Vietnam Open API", pro: true, enterprise: true },
                { name: "Lazada & E-Commerce APIs", pro: false, enterprise: false },
                { name: "Custom REST API / Webhook Sources", pro: false, enterprise: true },
            ],
        },
        {
            title: payCurrency === "VND" ? "Kho dữ liệu & Động cơ chuẩn hóa" : "Data Warehouse & Execution Engine",
            icon: Database,
            description: payCurrency === "VND" ? "Chuẩn hóa bảng dữ liệu đa kênh, tối ưu truy vấn tốc độ cao" : "Ultra-fast normalized multi-channel data schemas",
            features: [
                { name: "Normalized ad_insights_daily Schema", pro: true, enterprise: true },
                { name: "Campaign pacing schema", pro: true, enterprise: true },
                { name: "Maximum Connected Accounts & Shops", pro: "20 accounts", enterprise: "Unlimited" },
                { name: "Monthly Warehouse Sync Allowance", pro: "3,000 runs", enterprise: "Custom quota" },
                { name: "Multi-Tenant Workspace Guard", pro: true, enterprise: true },
                { name: "Dedicated warehouse support", pro: false, enterprise: true },
            ],
        },
        {
            title: payCurrency === "VND" ? "Kết nối báo cáo & Đầu ra" : "Destinations & Activation",
            icon: FileSpreadsheet,
            description: payCurrency === "VND" ? "Xuất dữ liệu tự động vào Google Sheets, Looker Studio và API" : "Live data delivery into Google Sheets, Looker Studio, and APIs",
            features: [
                { name: "Google Sheets™ Official Add-on", pro: true, enterprise: true },
                { name: "Looker Studio™ Partner Connector", pro: true, enterprise: true },
                { name: "Scheduled refreshes where enabled", pro: true, enterprise: true },
                { name: "Manual & nightly warehouse refreshes", pro: true, enterprise: true },
                { name: "Workspace REST API Access", pro: true, enterprise: true },
                { name: "Custom Webhook Trigger Notifications", pro: false, enterprise: true },
            ],
        },
        {
            title: payCurrency === "VND" ? "Bảo mật, Nhóm & Hỗ trợ" : "Security, Team & Support",
            icon: ShieldCheck,
            description: payCurrency === "VND" ? "Lưu trữ thông tin kết nối được mã hóa và hỗ trợ kỹ thuật" : "Encrypted connection storage and practical technical support",
            features: [
                { name: "Encrypted AES-256-GCM Token Vault", pro: true, enterprise: true },
                { name: "Team Member Seats", pro: "3 Seats", enterprise: "Custom seats" },
                { name: "VietQR payment", pro: true, enterprise: true },
                { name: "1-on-1 Priority Support (Zalo / Telegram)", pro: true, enterprise: true },
                { name: "Custom onboarding scope", pro: false, enterprise: true },
                { name: "Dedicated Data Engineering Architect", pro: false, enterprise: true },
            ],
        },
    ], [payCurrency]);

    const filteredCategories = useMemo(() => {
        if (!searchQuery.trim()) return comparisonCategories;
        const q = searchQuery.toLowerCase();
        return comparisonCategories.map((cat) => ({
            ...cat,
            features: cat.features.filter((f) => f.name.toLowerCase().includes(q)),
        })).filter((cat) => cat.features.length > 0);
    }, [comparisonCategories, searchQuery]);

    return (
        <div className="min-h-screen pt-20 pb-24 bg-canvas font-sans text-ink antialiased">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* ── Top Header Section ── */}
                <div className="text-center max-w-3xl mx-auto pt-6 mb-10">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[11px] font-medium text-ink-mute">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span>Predictable Flat-Rate Pricing</span>
                    </div>

                    <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-ink leading-[1.15]">
                        {payCurrency === "VND" ? (
                            <>Mở rộng quy mô,<br /><span className="text-neutral-400">kiểm soát chi phí.</span></>
                        ) : (
                            <>Scale your marketing,<br /><span className="text-neutral-400">control your data stack.</span></>
                        )}
                    </h1>

                    <p className="mt-4 text-sm sm:text-base text-ink-mute font-normal max-w-xl mx-auto leading-relaxed">
                        {payCurrency === "VND"
                            ? "Kho dữ liệu quảng cáo hợp nhất cho Agency. Đồng bộ trực tiếp Meta, TikTok, Google và Shopee vào Google Sheets & Looker Studio."
                            : "Monstera stores normalized reporting data in isolated PostgreSQL workspaces, then makes it available to Google Sheets and Looker Studio."}
                    </p>
                </div>

                {/* ── Billing Cycle Controls ── */}
                <div className="flex items-center justify-center mb-12">
                    {/* Annual / Monthly Toggle */}
                    <div className="inline-flex p-1 rounded-full bg-panel border border-line shadow-xs">
                        <button
                            type="button"
                            onClick={() => setIsAnnual(false)}
                            className={cn(
                                "px-4 py-1.5 rounded-full text-xs transition-all duration-150",
                                !isAnnual
                                    ? "bg-white text-black font-semibold shadow-xs"
                                    : "text-ink-mute hover:text-ink font-medium"
                            )}
                        >
                            {payCurrency === "VND" ? "Theo tháng" : "Monthly"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsAnnual(true)}
                            className={cn(
                                "px-4 py-1.5 rounded-full text-xs transition-all duration-150 flex items-center gap-1.5",
                                isAnnual
                                    ? "bg-white text-black font-semibold shadow-xs"
                                    : "text-ink-mute hover:text-ink font-medium"
                            )}
                        >
                            <span>{payCurrency === "VND" ? "Theo năm" : "Yearly"}</span>
                            <span
                                className={cn(
                                    "px-1.5 py-0.5 rounded-full text-[10px] font-bold tracking-tight",
                                    isAnnual
                                        ? "bg-black text-white"
                                        : "bg-neutral-800 text-neutral-300 border border-neutral-700"
                                )}
                            >
                                Annual
                            </span>
                        </button>
                    </div>
                </div>

                {/* Agency pricing and enterprise contact options. Legacy Starter workspaces remain supported in backend limits. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto items-stretch">

                    {/* ── AGENCY PRO [POPULAR] ── */}
                    <div className="relative rounded-xl p-7 bg-panel border border-white/20 flex flex-col justify-between transition-colors hover:border-white/30 ring-1 ring-white/10 shadow-lg">
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <h3 className="text-sm font-medium text-ink tracking-tight">Agency Pro</h3>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white/[0.1] text-ink border border-line">
                                    {payCurrency === "VND" ? "Dành cho Agency" : "Recommended for Agencies"}
                                </span>
                            </div>

                            {/* Stable Price Number */}
                            <div className="mb-4 flex items-baseline min-h-[48px]">
                                <span className="text-4xl lg:text-5xl font-bold tracking-tight text-ink">
                                    {proPricing.amountFormatted}
                                </span>
                                {proPricing.currencySymbol ? (
                                    <span className="text-xl font-bold text-ink-mute ml-1">
                                        {proPricing.currencySymbol}
                                    </span>
                                ) : null}
                                <span className="text-xs font-normal text-ink-mute ml-1.5">
                                    {proPricing.unit}
                                </span>
                            </div>

                            <p className="text-xs text-ink-mute leading-relaxed mb-6 min-h-[34px]">
                                {payCurrency === "VND"
                                    ? "Dành cho Agency vận hành và mở rộng báo cáo cho nhiều khách hàng."
                                    : "For marketing agencies managing multiple client brands and dashboards."}
                            </p>

                            {/* Decision-led bullets */}
                            <ul className="space-y-3 text-xs text-neutral-300 mb-8 border-t border-line pt-5">
                                <li className="flex items-center gap-2.5">
                                    <SlidersHorizontal className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Tối đa 20 Tài khoản quảng cáo & Shop"
                                            : "Up to 20 ad accounts & shop scopes"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Layers className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Cô lập dữ liệu Workspace từng khách hàng"
                                            : "Multi-tenant client workspace isolation"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Clock className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Làm mới kho dữ liệu thủ công và hàng đêm"
                                            : "Manual & nightly warehouse refreshes"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Users className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "3 Thành viên nhóm & phân quyền chi tiết"
                                            : "Team collaboration & 3 member seats"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Headphones className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Hỗ trợ kỹ thuật 1-1 qua Zalo / Telegram"
                                            : "1-on-1 Priority support (Zalo / Telegram)"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Zap className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "3.000 Lượt làm mới dữ liệu ưu tiên"
                                            : "3,000 Priority warehouse syncs"}
                                    </span>
                                </li>
                            </ul>
                        </div>

                        {payCurrency === "VND" && workspaceId ? (
                            <button
                                onClick={() => openVietQr("professional", "Agency Pro")}
                                className="w-full py-2.5 px-4 rounded-md bg-white hover:bg-neutral-200 text-black text-xs font-semibold transition-colors flex items-center justify-center gap-2 shadow-xs"
                            >
                                <QrCode className="w-3.5 h-3.5 text-black" />
                                <span>Thanh toán VietQR</span>
                            </button>
                        ) : (
                            <Link
                                href="/register"
                                className="w-full py-2.5 px-4 rounded-md bg-white hover:bg-neutral-200 text-black text-xs font-semibold transition-colors flex items-center justify-center gap-2 shadow-xs"
                            >
                                <span>{payCurrency === "VND" ? "Dùng thử Agency Pro 7 ngày" : "Start 7-day free pilot"}</span>
                            </Link>
                        )}
                    </div>

                    {/* ── ENTERPRISE ── */}
                    <div className="relative rounded-xl p-7 bg-panel border border-line flex flex-col justify-between transition-colors hover:border-white/20">
                        <div>
                            <div className="mb-3">
                                <h3 className="text-sm font-medium text-ink tracking-tight">Enterprise</h3>
                            </div>

                            {/* Stable Price Number */}
                            <div className="mb-4 flex items-baseline min-h-[48px]">
                                <span className="text-4xl lg:text-5xl font-bold tracking-tight text-ink">
                                    {enterprisePricing.amountFormatted}
                                </span>
                            </div>

                            <p className="text-xs text-ink-mute leading-relaxed mb-6 min-h-[34px]">
                                {payCurrency === "VND"
                                    ? "Bảo mật nâng cao, hỗ trợ kho dữ liệu riêng và hỗ trợ kỹ thuật chuyên sâu."
                                    : "Dedicated warehouse support and custom pipeline guidance."}
                            </p>

                            {/* Decision-led bullets */}
                            <ul className="space-y-3 text-xs text-neutral-300 mb-8 border-t border-line pt-5">
                                <li className="flex items-center gap-2.5">
                                    <Workflow className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Không giới hạn tài khoản & pipeline tùy chỉnh"
                                            : "Unlimited accounts & custom pipelines"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Database className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Hỗ trợ kho dữ liệu riêng"
                                            : "Dedicated warehouse support"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Lock className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Phạm vi phân quyền theo nhu cầu"
                                            : "Access controls scoped to your needs"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <ShieldCheck className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Lộ trình triển khai và hỗ trợ theo phạm vi"
                                            : "Implementation and support scope agreed together"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Cpu className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Kỹ sư dữ liệu hỗ trợ triển khai riêng"
                                            : "Dedicated data engineering architect"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Coins className="w-4 h-4 text-ink-mute shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Báo giá theo nhu cầu vận hành"
                                            : "Custom commercial scope"}
                                    </span>
                                </li>
                            </ul>
                        </div>

                        <Link
                            href="mailto:support@monsteracloud.com?subject=Inquiry%20Enterprise%20Plan%20Monstera%20Cloud"
                            className="w-full py-2.5 px-4 rounded-md border border-line bg-canvas hover:bg-white/[0.04] text-ink text-xs font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <span>{payCurrency === "VND" ? "Liên hệ tư vấn Enterprise" : "Contact sales"}</span>
                        </Link>
                    </div>

                </div>

                {/* ── Full Feature Comparison Matrix with Sticky Header & Row Hover ── */}
                <div className="mt-28 w-full">
                    {/* Comparison Header Bar */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-line">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-ink">
                                {payCurrency === "VND" ? "So sánh chi tiết tất cả tính năng" : "Compare all features"}
                            </h2>
                            <p className="text-xs text-ink-mute mt-1">
                                {payCurrency === "VND"
                                    ? "Chi tiết thông số kỹ thuật, giới hạn kết nối và quyền lợi từng gói dịch vụ."
                                    : "Detailed technical breakdown, limits, and capabilities across all tiers."}
                            </p>
                        </div>

                        {/* Search Feature Input */}
                        <div className="relative w-full sm:w-64">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
                            <input
                                type="text"
                                placeholder={payCurrency === "VND" ? "Tìm kiếm tính năng..." : "Search feature..."}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-panel border border-line rounded-md pl-9 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-mute/70 focus:outline-none focus:border-white/25 transition-colors"
                            />
                        </div>
                    </div>

                    {/* Sticky Table Header */}
                    <div className="sticky top-13 z-20 bg-canvas/95 backdrop-blur-md grid grid-cols-12 py-3.5 border-b border-line text-sm font-semibold text-ink">
                        <div className="col-span-6 sm:col-span-6 text-ink-mute text-xs uppercase tracking-wider font-mono">
                            {payCurrency === "VND" ? "TÍNH NĂNG" : "FEATURE"}
                        </div>
                        <div className="col-span-3 text-center text-xs sm:text-sm font-semibold text-white">Agency Pro</div>
                        <div className="col-span-3 text-center text-xs sm:text-sm font-semibold">Enterprise</div>
                    </div>

                    <div className="divide-y divide-line/60">
                        {filteredCategories.map((category, catIdx) => {
                            const CategoryIcon = category.icon;
                            return (
                                <div key={catIdx} className="pt-6 pb-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <CategoryIcon className="w-4 h-4 text-ink-mute" />
                                        <h3 className="text-sm font-semibold text-ink">{category.title}</h3>
                                    </div>
                                    <p className="text-xs text-ink-mute mb-4">{category.description}</p>

                                    <div className="space-y-0.5">
                                        {category.features.map((feature, fIdx) => (
                                            <div
                                                key={fIdx}
                                                className="grid grid-cols-12 py-3 px-2 rounded-md hover:bg-white/[0.03] transition-colors duration-150 items-center text-xs"
                                            >
                                                <div className="col-span-6 text-neutral-300 font-normal pr-2">
                                                    {feature.name}
                                                </div>

                                                <div className="col-span-3 flex items-center justify-center text-center">
                                                    {typeof feature.pro === "boolean" ? (
                                                        feature.pro ? (
                                                            <Check className="w-3.5 h-3.5 text-white" />
                                                        ) : (
                                                            <span className="text-neutral-700 font-light">—</span>
                                                        )
                                                    ) : (
                                                        <span className="font-mono text-[11px] font-medium text-white">{feature.pro}</span>
                                                    )}
                                                </div>

                                                <div className="col-span-3 flex items-center justify-center text-center">
                                                    {typeof feature.enterprise === "boolean" ? (
                                                        feature.enterprise ? (
                                                            <Check className="w-3.5 h-3.5 text-neutral-300" />
                                                        ) : (
                                                            <span className="text-neutral-700 font-light">—</span>
                                                        )
                                                    ) : (
                                                        <span className="font-mono text-[11px] text-neutral-300">{feature.enterprise}</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Custom setup callout */}
                <div className="mt-16 w-full rounded-xl p-6 bg-panel border border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
                    <div>
                        <h4 className="font-semibold text-sm text-ink">
                            {payCurrency === "VND" ? "Bạn cần tư vấn kiến trúc dữ liệu riêng?" : "Looking for custom data engineering or bespoke setup?"}
                        </h4>
                        <p className="text-xs text-ink-mute mt-1">
                            {payCurrency === "VND"
                                ? "Đội ngũ kỹ thuật của Monstera Cloud sẵn sàng hỗ trợ setup và đào tạo trực tiếp cho Agency của bạn."
                                : "Our engineering team provides direct onboarding, custom connector development, and dedicated warehouse support."}
                        </p>
                    </div>
                    <Link
                        href="mailto:support@monsteracloud.com"
                        className="px-4 py-2 rounded-md bg-canvas border border-line text-xs font-medium text-ink hover:bg-white/[0.04] transition-colors whitespace-nowrap"
                    >
                        {payCurrency === "VND" ? "Gặp chuyên gia tư vấn" : "Talk to Sales"}
                    </Link>
                </div>

            </div>

            {/* VietQR Modal */}
            <VietQrModal
                isOpen={qrModalOpen}
                onClose={() => setQrModalOpen(false)}
                planName={selectedQrPlan.name}
                planDisplayName={selectedQrPlan.displayName}
                billingCycle={isAnnual ? "annual" : "monthly"}
                amountVnd={selectedQrPlan.amount}
                workspaceId={workspaceId}
            />
        </div>
    );
}

export default function PricingPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
            <PricingPageContent />
        </Suspense>
    );
}
