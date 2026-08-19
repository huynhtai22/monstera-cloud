"use client";

import Link from "next/link";
import {
    Check,
    Sparkles,
    ArrowRight,
    Building2,
    Lock,
    ShieldCheck,
    Layers,
    RefreshCw,
    ChevronDown,
    QrCode,
    Search,
    Database,
    FileSpreadsheet,
    BarChart2,
    KeyRound,
    Clock,
    Users,
    Zap,
    Globe,
    Shield,
    Activity,
    Cpu,
    ArrowDownToLine,
    CreditCard,
    Headphones,
    Coins,
    SlidersHorizontal,
    Workflow,
} from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { VietQrModal } from "@/components/pricing/VietQrModal";
import { useState, useEffect, useMemo } from "react";
import { metaPixelCustom } from "@/lib/meta-pixel";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { PLAN_PRICING, type PlanName } from "@/lib/plan-config";

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);
    const [payCurrency, setPayCurrency] = useState<"VND" | "USD">("USD");
    const [currencyReady, setCurrencyReady] = useState(false);
    const [regionHint, setRegionHint] = useState<string | null>(null);
    const [openFaq, setOpenFaq] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    // VietQR Modal State
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const [selectedQrPlan, setSelectedQrPlan] = useState<{
        name: "starter" | "professional" | "enterprise";
        displayName: string;
        amount: number;
    }>({ name: "professional", displayName: "Agency Pro", amount: 990000 });

    useEffect(() => {
        let isMounted = true;
        async function detectGeo() {
            try {
                const res = await fetch("/api/geo");
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted && data?.country) {
                        setRegionHint(data.country);
                        if (data.country === "VN") {
                            setPayCurrency("VND");
                        }
                    }
                }
            } catch {
                // Fallback gracefully
            } finally {
                if (isMounted) setCurrencyReady(true);
            }
        }
        detectGeo();
        return () => {
            isMounted = false;
        };
    }, []);

    const openVietQr = (planKey: "starter" | "professional" | "enterprise", planDisplayName: string) => {
        let amount = 990000;
        if (planKey === "starter") {
            amount = isAnnual ? PLAN_PRICING.starter.vndAnnualMonthly : PLAN_PRICING.starter.vndMonthly;
        } else if (planKey === "professional") {
            amount = isAnnual ? PLAN_PRICING.professional.vndAnnualMonthly : PLAN_PRICING.professional.vndMonthly;
        }

        setSelectedQrPlan({
            name: planKey,
            displayName: planDisplayName,
            amount: isAnnual ? amount * 12 : amount,
        });
        setQrModalOpen(true);

        metaPixelCustom("MC_VietQR_Modal_Opened", {
            plan: planKey,
            billing_cycle: isAnnual ? "annual" : "monthly",
            amount_vnd: isAnnual ? amount * 12 : amount,
        });
    };

    const starterPricing = {
        amountFormatted: payCurrency === "VND" ? (isAnnual ? "390.000" : "490.000") : isAnnual ? "$19" : "$24",
        currencySymbol: payCurrency === "VND" ? "đ" : "",
        unit: payCurrency === "VND" ? "/ tháng" : "/ mo .",
        billingNote: isAnnual ? (payCurrency === "VND" ? "Thanh toán 1 năm (tiết kiệm 20%)" : "Billed annually or $24 monthly") : (payCurrency === "VND" ? "Thanh toán từng tháng" : "Billed monthly"),
    };

    const proPricing = {
        amountFormatted: payCurrency === "VND" ? (isAnnual ? "990.000" : "1.290.000") : isAnnual ? "$49" : "$59",
        currencySymbol: payCurrency === "VND" ? "đ" : "",
        unit: payCurrency === "VND" ? "/ tháng" : "/ mo .",
        billingNote: isAnnual ? (payCurrency === "VND" ? "Thanh toán 1 năm (tiết kiệm 20%)" : "Billed annually or $59 monthly") : (payCurrency === "VND" ? "Thanh toán từng tháng" : "Billed monthly"),
    };

    const enterprisePricing = {
        amountFormatted: payCurrency === "VND" ? "Liên hệ" : "Custom",
        currencySymbol: "",
        unit: "",
        billingNote: payCurrency === "VND" ? "Hợp đồng doanh nghiệp & SLA riêng" : "Custom annual contract & SLA",
    };

    const comparisonCategories = useMemo(() => [
        {
            title: payCurrency === "VND" ? "Kênh quảng cáo & Thu thập dữ liệu" : "Data Ingestion & Ad Channels",
            icon: Globe,
            description: payCurrency === "VND" ? "Kết nối trực tiếp API chính thức không qua trung gian" : "Direct official OAuth APIs with zero intermediate hops",
            features: [
                { name: "Meta Ads (Facebook & Instagram)", starter: true, pro: true, enterprise: true },
                { name: "TikTok Ads & TikTok Shop", starter: true, pro: true, enterprise: true },
                { name: "Google Ads (Search & PMax)", starter: true, pro: true, enterprise: true },
                { name: "Shopee Vietnam Open API", starter: true, pro: true, enterprise: true },
                { name: "Lazada & E-Commerce APIs", starter: false, pro: true, enterprise: true },
                { name: "Custom REST API / Webhook Sources", starter: false, pro: false, enterprise: true },
            ],
        },
        {
            title: payCurrency === "VND" ? "Kho dữ liệu & Động cơ chuẩn hóa" : "Data Warehouse & Execution Engine",
            icon: Database,
            description: payCurrency === "VND" ? "Chuẩn hóa bảng dữ liệu đa kênh, tối ưu truy vấn tốc độ cao" : "Ultra-fast normalized multi-channel data schemas",
            features: [
                { name: "Normalized `ad_insights_daily` Schema", starter: true, pro: true, enterprise: true },
                { name: "Hourly Campaign Pacing Schema", starter: false, pro: true, enterprise: true },
                { name: "Maximum Connected Accounts & Shops", starter: "5 accounts", pro: "20 accounts", enterprise: "Unlimited" },
                { name: "Monthly Warehouse Sync Allowance", starter: "500 runs", pro: "3,000 runs", enterprise: "Custom quota" },
                { name: "Multi-Tenant Workspace Guard", starter: false, pro: true, enterprise: true },
                { name: "Dedicated PostgreSQL / BigQuery Warehouse", starter: false, pro: false, enterprise: true },
            ],
        },
        {
            title: payCurrency === "VND" ? "Kết nối báo cáo & Đầu ra" : "Destinations & Activation",
            icon: FileSpreadsheet,
            description: payCurrency === "VND" ? "Xuất dữ liệu tự động vào Google Sheets, Looker Studio và API" : "Live data delivery into Google Sheets, Looker Studio, and APIs",
            features: [
                { name: "Google Sheets™ Official Add-on", starter: true, pro: true, enterprise: true },
                { name: "Looker Studio™ Partner Connector", starter: true, pro: true, enterprise: true },
                { name: "Automated Daily Scheduled Syncs", starter: true, pro: true, enterprise: true },
                { name: "Hourly & Nightly Automated Refreshes", starter: false, pro: true, enterprise: true },
                { name: "Workspace REST API Access", starter: false, pro: true, enterprise: true },
                { name: "Custom Webhook Trigger Notifications", starter: false, pro: false, enterprise: true },
            ],
        },
        {
            title: payCurrency === "VND" ? "Bảo mật, Nhóm & Hỗ trợ" : "Security, Team & Support",
            icon: ShieldCheck,
            description: payCurrency === "VND" ? "Mã hóa cấp ngân hàng và hỗ trợ kỹ thuật tận tâm" : "Bank-grade token encryption and dedicated technical onboarding",
            features: [
                { name: "Encrypted AES-256-GCM Token Vault", starter: true, pro: true, enterprise: true },
                { name: "Team Member Seats", starter: "1 Admin", pro: "3 Seats", enterprise: "Custom seats" },
                { name: "VietQR Napas 24/7 Payment & VAT Invoice", starter: true, pro: true, enterprise: true },
                { name: "1-on-1 Zalo / Telegram Priority Support", starter: false, pro: true, enterprise: true },
                { name: "99.9% Uptime Enterprise SLA", starter: false, pro: false, enterprise: true },
                { name: "Dedicated Data Engineering Architect", starter: false, pro: false, enterprise: true },
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

    const faqs = [
        {
            q: payCurrency === "VND" ? "Tôi có thể thanh toán bằng VietQR và nhận hóa đơn VAT không?" : "Can I pay with VietQR and receive a VAT invoice?",
            a: payCurrency === "VND"
                ? "Có! Monstera Cloud hỗ trợ thanh toán tức thì qua mã VietQR Napas 24/7 của tất cả các ngân hàng Việt Nam. Sau khi thanh toán, hệ thống tự động kích hoạt và xuất hóa đơn điện tử VAT cho công ty của bạn."
                : "Yes! For Vietnamese agencies, we support instant VietQR (Napas 24/7) bank transfers and automated electronic VAT invoicing. International customers can pay via Paddle in USD.",
        },
        {
            q: payCurrency === "VND" ? "Gói Agency Pro tính phí như thế nào khi tôi quản lý nhiều tài khoản?" : "How does the Agency Pro plan charge for multiple ad accounts?",
            a: payCurrency === "VND"
                ? "Gói Agency Pro có mức phí cố định hàng tháng cho tối đa 20 tài khoản quảng cáo và gian hàng (Meta, Google, TikTok, Shopee). Bạn không phải trả thêm phí ẩn theo ngân sách chạy ads hay số lượng dòng dữ liệu."
                : "Agency Pro includes a flat monthly rate for up to 20 ad accounts and shops across Meta, Google, TikTok, and Shopee. There are zero surprise overage fees based on ad spend volume.",
        },
        {
            q: payCurrency === "VND" ? "Dữ liệu có được tự động làm mới trong Google Sheets không?" : "Does data automatically refresh in Google Sheets?",
            a: payCurrency === "VND"
                ? "Có! Add-on của Monstera Cloud cho phép bạn thiết lập lịch tự động làm mới hàng ngày hoặc hàng giờ. Mỗi sáng khi bạn mở Google Sheet, toàn bộ số liệu chi tiêu và doanh thu đã sẵn sàng."
                : "Yes! The Monstera Cloud Google Sheets Add-on supports automated scheduled refreshes (hourly and daily) so your reports are always up to date when you open them.",
        },
        {
            q: payCurrency === "VND" ? "Chính sách dùng thử và hủy dịch vụ như thế nào?" : "What is the trial and cancellation policy?",
            a: payCurrency === "VND"
                ? "Tất cả khách hàng được trải nghiệm 14 ngày đầy đủ tính năng. Bạn có thể nâng cấp, hạ cấp hoặc hủy gói bất kỳ lúc nào mà không có ràng buộc."
                : "You can start with our 14-day full pilot trial. You can upgrade, downgrade, or cancel your subscription at any time without lock-in.",
        },
    ];

    return (
        <div className="min-h-screen pt-28 pb-24 bg-canvas font-sans text-ink antialiased selection:bg-white selection:text-black">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* ── Top Header Section (Vercel Style) ─────────────────────────────── */}
                <div className="text-center max-w-3xl mx-auto pt-6 mb-10">
                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1]">
                        {payCurrency === "VND" ? (
                            <>Mở rộng quy mô,<br />kiểm soát chi phí</>
                        ) : (
                            <>Scale your marketing,<br />control your costs</>
                        )}
                    </h1>

                    <p className="mt-4 text-sm sm:text-base text-neutral-400 font-normal max-w-xl mx-auto leading-relaxed">
                        {payCurrency === "VND"
                            ? "Kho dữ liệu quảng cáo hợp nhất cho Agency. Đồng bộ trực tiếp Meta, TikTok, Google và Shopee vào Google Sheets & Looker Studio."
                            : "Predictable, flat-rate ad data warehousing. Direct API sync from Meta, TikTok, Google, and Shopee straight into Google Sheets and Looker Studio."}
                    </p>
                </div>

                {/* ── Polished Billing Cycle Toggle ─────────────────────────────────── */}
                <div className="flex items-center justify-center mb-12">
                    <div className="inline-flex p-1 rounded-full bg-[#0c0c0c] border border-[#222] shadow-inner">
                        <button
                            type="button"
                            onClick={() => setIsAnnual(false)}
                            className={`px-4 py-1.5 rounded-full text-xs transition-all duration-150 ${
                                !isAnnual
                                    ? "bg-white text-black font-semibold shadow-xs"
                                    : "text-neutral-400 hover:text-white font-medium"
                            }`}
                        >
                            {payCurrency === "VND" ? "Theo tháng" : "Monthly"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsAnnual(true)}
                            className={`px-4 py-1.5 rounded-full text-xs transition-all duration-150 flex items-center gap-1.5 ${
                                isAnnual
                                    ? "bg-white text-black font-semibold shadow-xs"
                                    : "text-neutral-400 hover:text-white font-medium"
                            }`}
                        >
                            <span>{payCurrency === "VND" ? "Theo năm" : "Yearly"}</span>
                            <span
                                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tracking-tight ${
                                    isAnnual
                                        ? "bg-black text-white"
                                        : "bg-neutral-800 text-neutral-300 border border-neutral-700"
                                }`}
                            >
                                −20%
                            </span>
                        </button>
                    </div>
                </div>

                {/* ── 3-Pillar Pricing Cards (Vercel Exact UI) ───────────────────────── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full items-stretch">

                    {/* ── PILLAR 1: STARTER / HOBBY ────────────────────────────────────── */}
                    <div className="relative rounded-xl p-7 bg-[#0a0a0a] border border-line flex flex-col justify-between transition-all hover:border-[#383838]">
                        <div>
                            {/* Plan Title */}
                            <div className="mb-4">
                                <h3 className="text-sm font-medium text-white tracking-tight">Starter</h3>
                            </div>

                            {/* Huge Bold Price Number */}
                            <div className="mb-4 flex items-baseline">
                                <span className="text-5xl lg:text-6xl font-bold tracking-tight text-white">
                                    {starterPricing.amountFormatted}
                                </span>
                                {starterPricing.currencySymbol ? (
                                    <span className="text-2xl font-bold text-neutral-400 ml-1">
                                        {starterPricing.currencySymbol}
                                    </span>
                                ) : null}
                                <span className="text-xs font-normal text-neutral-400 ml-1.5">
                                    {starterPricing.unit}
                                </span>
                            </div>

                            {/* Plan Description */}
                            <p className="text-xs text-neutral-400 leading-relaxed mb-6 min-h-[36px]">
                                {payCurrency === "VND"
                                    ? "Nền tảng khởi đầu hoàn hảo cho Media Buyer cá nhân và chủ shop tự động hóa báo cáo."
                                    : "The perfect starting place for solo media buyers and indie shop owners."}
                            </p>

                            {/* Feature List with Outlined Icons */}
                            <ul className="space-y-3 text-xs text-neutral-300 mb-8">
                                <li className="flex items-center gap-2.5">
                                    <ArrowDownToLine className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Đồng bộ Meta, Google, TikTok & Shopee"
                                            : "Import Meta, Google, TikTok & Shopee"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <FileSpreadsheet className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>Google Sheets™ Add-on &amp; Looker Studio</span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Zap className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "500 Lượt làm mới kho dữ liệu / tháng"
                                            : "500 Warehouse syncs / month"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Shield className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Tối đa 5 Tài khoản quảng cáo & Shop"
                                            : "Up to 5 Ad accounts & shop scopes"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Clock className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Tự động làm mới dữ liệu hàng ngày"
                                            : "Daily automated scheduled refresh"}
                                    </span>
                                </li>
                            </ul>
                        </div>

                        {/* Bottom Pill CTA Button */}
                        {payCurrency === "VND" ? (
                            <button
                                onClick={() => openVietQr("starter", "Starter")}
                                className="w-full py-2.5 px-4 rounded-full border border-line bg-[#111] hover:bg-[#1c1c1c] text-white text-xs font-medium transition-all flex items-center justify-center gap-2"
                            >
                                <QrCode className="w-3.5 h-3.5 text-neutral-300" />
                                <span>Thanh toán VietQR</span>
                            </button>
                        ) : (
                            <CheckoutButton
                                plan="starter"
                                billingCycle={isAnnual ? "annual" : "monthly"}
                                invoiceCurrency={payCurrency}
                                metaPixelEvent="MC_Pricing_Starter_Checkout"
                                metaPixelParams={{ billing_cycle: isAnnual ? "annual" : "monthly", currency: payCurrency }}
                                className="w-full py-2.5 px-4 rounded-full border border-line bg-[#111] hover:bg-[#1c1c1c] text-white text-xs font-medium transition-all flex items-center justify-center gap-2"
                            >
                                <span>Get Started</span>
                            </CheckoutButton>
                        )}
                    </div>

                    {/* ── PILLAR 2: AGENCY PRO [POPULAR] ───────────────────────────────── */}
                    <div className="relative rounded-xl p-7 bg-[#0a0a0a] border border-line flex flex-col justify-between transition-all hover:border-[#444] ring-1 ring-white/10">
                        <div>
                            {/* Plan Title & Popular Badge */}
                            <div className="flex items-center gap-2 mb-4">
                                <h3 className="text-sm font-medium text-white tracking-tight">Pro</h3>
                                <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#222] text-neutral-300 border border-line">
                                    {payCurrency === "VND" ? "Phổ biến" : "Popular"}
                                </span>
                            </div>

                            {/* Huge Bold Price Number */}
                            <div className="mb-4 flex items-baseline">
                                <span className="text-5xl lg:text-6xl font-bold tracking-tight text-white">
                                    {proPricing.amountFormatted}
                                </span>
                                {proPricing.currencySymbol ? (
                                    <span className="text-2xl font-bold text-neutral-400 ml-1">
                                        {proPricing.currencySymbol}
                                    </span>
                                ) : null}
                                <span className="text-xs font-normal text-neutral-400 ml-1.5">
                                    {proPricing.unit}
                                </span>
                            </div>

                            {/* Plan Description */}
                            <p className="text-xs text-neutral-400 leading-relaxed mb-6 min-h-[36px]">
                                {payCurrency === "VND"
                                    ? "Tất cả công cụ cần thiết để vận hành và mở rộng báo cáo agency nhiều khách hàng."
                                    : "Everything you need to build and scale multi-client agency reporting."}
                            </p>

                            {/* Subheader */}
                            <p className="text-xs font-medium text-white mb-3">
                                {payCurrency === "VND" ? "Bao gồm tất cả tính năng Starter, cộng thêm:" : "All Starter features, plus:"}
                            </p>

                            {/* Feature List with Outlined Icons */}
                            <ul className="space-y-3 text-xs text-neutral-300 mb-8">
                                <li className="flex items-center gap-2.5">
                                    <Users className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "3 Thành viên nhóm & phân quyền"
                                            : "Team collaboration & 3 member seats"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Zap className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "3.000 Lượt làm mới dữ liệu ưu tiên"
                                            : "3,000 Priority warehouse syncs"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Layers className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Cô lập dữ liệu Workspace từng khách hàng"
                                            : "Multi-tenant client workspace isolation"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Clock className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Lịch làm mới tự động theo giờ & ban đêm"
                                            : "Hourly & nightly scheduled syncs"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <SlidersHorizontal className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Tối đa 20 Tài khoản quảng cáo & Shop"
                                            : "Up to 20 Ad accounts & shop scopes"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Headphones className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Hỗ trợ kỹ thuật 1-1 qua Zalo / Telegram"
                                            : "1-on-1 Priority support (Zalo / Telegram)"}
                                    </span>
                                </li>
                            </ul>
                        </div>

                        {/* Bottom Pill CTA Button (Solid Stark White) */}
                        {payCurrency === "VND" ? (
                            <button
                                onClick={() => openVietQr("professional", "Agency Pro")}
                                className="w-full py-2.5 px-4 rounded-full bg-white hover:bg-neutral-200 text-black text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow-xs"
                            >
                                <QrCode className="w-3.5 h-3.5 text-black" />
                                <span>Thanh toán VietQR (Kích hoạt ngay)</span>
                            </button>
                        ) : (
                            <CheckoutButton
                                plan="professional"
                                billingCycle={isAnnual ? "annual" : "monthly"}
                                invoiceCurrency={payCurrency}
                                metaPixelEvent="MC_Pricing_Pro_Checkout"
                                metaPixelParams={{ billing_cycle: isAnnual ? "annual" : "monthly", currency: payCurrency }}
                                className="w-full py-2.5 px-4 rounded-full bg-white hover:bg-neutral-200 text-black text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow-xs"
                            >
                                <span>Start a free trial</span>
                            </CheckoutButton>
                        )}
                    </div>

                    {/* ── PILLAR 3: ENTERPRISE ────────────────────────────────────────── */}
                    <div className="relative rounded-xl p-7 bg-[#0a0a0a] border border-line flex flex-col justify-between transition-all hover:border-[#383838]">
                        <div>
                            {/* Plan Title */}
                            <div className="mb-4">
                                <h3 className="text-sm font-medium text-white tracking-tight">Enterprise</h3>
                            </div>

                            {/* Huge Bold Price Number */}
                            <div className="mb-4 flex items-baseline">
                                <span className="text-5xl lg:text-6xl font-bold tracking-tight text-white">
                                    {enterprisePricing.amountFormatted}
                                </span>
                            </div>

                            {/* Plan Description */}
                            <p className="text-xs text-neutral-400 leading-relaxed mb-6 min-h-[36px]">
                                {payCurrency === "VND"
                                    ? "Bảo mật nâng cao, kho PostgreSQL / BigQuery riêng, SLA 99.9% và hỗ trợ kỹ thuật chuyên sâu."
                                    : "Critical security, dedicated PostgreSQL/BigQuery, platform SLAs, and custom support."}
                            </p>

                            {/* Subheader */}
                            <p className="text-xs font-medium text-white mb-3">
                                {payCurrency === "VND" ? "Bao gồm tất cả tính năng Pro, cộng thêm:" : "All Pro features, plus:"}
                            </p>

                            {/* Feature List with Outlined Icons */}
                            <ul className="space-y-3 text-xs text-neutral-300 mb-8">
                                <li className="flex items-center gap-2.5">
                                    <Lock className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Quản trị phân quyền nâng cao & SSO"
                                            : "Guest & Team access controls & SSO"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Database className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Kho dữ liệu PostgreSQL / BigQuery riêng"
                                            : "Dedicated PostgreSQL / BigQuery warehouse"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Workflow className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Không giới hạn tài khoản & pipeline tùy chỉnh"
                                            : "Unlimited accounts & custom pipelines"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <ShieldCheck className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Cam kết SLA 99.9% cho doanh nghiệp"
                                            : "99.9% Enterprise SLA guarantee"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Coins className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Xuất hóa đơn VAT điện tử hàng tháng"
                                            : "Monthly electronic VAT invoices"}
                                    </span>
                                </li>
                                <li className="flex items-center gap-2.5">
                                    <Cpu className="w-4 h-4 text-neutral-400 shrink-0" />
                                    <span>
                                        {payCurrency === "VND"
                                            ? "Kỹ sư dữ liệu hỗ trợ triển khai riêng"
                                            : "Dedicated data engineering architect"}
                                    </span>
                                </li>
                            </ul>
                        </div>

                        {/* Bottom Pill CTA Button */}
                        <Link
                            href="mailto:support@monsteracloud.com?subject=Inquiry%20Enterprise%20Plan%20Monstera%20Cloud"
                            className="w-full py-2.5 px-4 rounded-full border border-line bg-[#111] hover:bg-[#1c1c1c] text-white text-xs font-medium transition-all flex items-center justify-center gap-2"
                        >
                            <span>{payCurrency === "VND" ? "Liên hệ tư vấn Enterprise" : "Get a demo"}</span>
                        </Link>
                    </div>

                </div>

                {/* ── Full Feature Comparison Matrix (Vercel Screenshot 2 Style) ──────── */}
                <div className="mt-28 w-full">
                    {/* Comparison Header Bar */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-line">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-white">
                                {payCurrency === "VND" ? "So sánh chi tiết tất cả tính năng" : "Compare all features"}
                            </h2>
                            <p className="text-xs text-neutral-400 mt-1">
                                {payCurrency === "VND"
                                    ? "Chi tiết thông số kỹ thuật, giới hạn kết nối và quyền lợi từng gói dịch vụ."
                                    : "Detailed feature breakdown, limits, and technical capabilities across all tiers."}
                            </p>
                        </div>

                        {/* Search Feature Input */}
                        <div className="relative w-full sm:w-64">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                            <input
                                type="text"
                                placeholder={payCurrency === "VND" ? "Tìm kiếm tính năng..." : "Search feature..."}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-[#0a0a0a] border border-line rounded-md pl-9 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-400 transition-colors"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-12 py-4 border-b border-line text-sm font-semibold text-white">
                        <div className="col-span-6 sm:col-span-6 text-neutral-400 text-xs uppercase tracking-wider font-mono">
                            {payCurrency === "VND" ? "TÍNH NĂNG" : "FEATURE"}
                        </div>
                        <div className="col-span-2 text-center text-xs sm:text-sm">Starter</div>
                        <div className="col-span-2 text-center text-xs sm:text-sm">Pro</div>
                        <div className="col-span-2 text-center text-xs sm:text-sm">Enterprise</div>
                    </div>

                    <div className="divide-y divide-line/60">
                        {filteredCategories.map((category, catIdx) => {
                            const CategoryIcon = category.icon;
                            return (
                                <div key={catIdx} className="pt-6 pb-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <CategoryIcon className="w-4 h-4 text-neutral-400" />
                                        <h3 className="text-sm font-semibold text-white">{category.title}</h3>
                                    </div>
                                    <p className="text-xs text-neutral-500 mb-4">{category.description}</p>

                                    <div className="space-y-0.5">
                                        {category.features.map((feature, fIdx) => (
                                            <div
                                                key={fIdx}
                                                className="grid grid-cols-12 py-3 px-2 rounded hover:bg-[#0e0e0e] transition-colors items-center text-xs"
                                            >
                                                <div className="col-span-6 text-neutral-300 font-normal pr-2">
                                                    {feature.name}
                                                </div>

                                                <div className="col-span-2 flex items-center justify-center text-center">
                                                    {typeof feature.starter === "boolean" ? (
                                                        feature.starter ? (
                                                            <Check className="w-3.5 h-3.5 text-neutral-300" />
                                                        ) : (
                                                            <span className="text-neutral-700 font-light">—</span>
                                                        )
                                                    ) : (
                                                        <span className="font-mono text-[11px] text-neutral-300">{feature.starter}</span>
                                                    )}
                                                </div>

                                                <div className="col-span-2 flex items-center justify-center text-center">
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

                                                <div className="col-span-2 flex items-center justify-center text-center">
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

                <div className="mt-20 w-full rounded-xl p-6 bg-[#0a0a0a] border border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
                    <div>
                        <h4 className="font-bold text-sm text-white">
                            {payCurrency === "VND" ? "Bạn cần tư vấn kiến trúc dữ liệu riêng?" : "Looking for custom data engineering or bespoke setup?"}
                        </h4>
                        <p className="text-xs text-neutral-400 mt-1">
                            {payCurrency === "VND"
                                ? "Đội ngũ kỹ thuật của Monstera Cloud sẵn sàng hỗ trợ setup và đào tạo trực tiếp cho Agency của bạn."
                                : "Our engineering team provides direct onboarding, custom connector development, and dedicated warehouse support."}
                        </p>
                    </div>
                    <Link
                        href="mailto:support@monsteracloud.com"
                        className="px-4 py-2 rounded-full bg-[#111] border border-line text-xs font-medium text-white hover:bg-[#1a1a1a] transition-colors whitespace-nowrap"
                    >
                        {payCurrency === "VND" ? "Gặp chuyên gia tư vấn" : "Talk to Sales"}
                    </Link>
                </div>

                <div className="mt-20 pt-10 border-t border-line text-center w-full">
                    <p className="text-xs font-mono font-semibold uppercase tracking-widest text-neutral-500 mb-8">
                        {payCurrency === "VND" ? "TIÊU CHUẨN AN TOÀN & BẢO MẬT" : "SECURITY & COMPLIANCE STANDARDS"}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full text-xs text-neutral-400">
                        <div className="flex flex-col items-center p-4 rounded-xl bg-[#0a0a0a] border border-line">
                            <Lock className="w-5 h-5 text-white mb-2" />
                            <span className="font-semibold text-white">AES-256-GCM</span>
                            <span className="text-[11px] text-neutral-500 mt-0.5">Mã hóa dữ liệu 2 lớp</span>
                        </div>
                        <div className="flex flex-col items-center p-4 rounded-xl bg-[#0a0a0a] border border-line">
                            <ShieldCheck className="w-5 h-5 text-white mb-2" />
                            <span className="font-semibold text-white">Google OAuth 2.0</span>
                            <span className="text-[11px] text-neutral-500 mt-0.5">Xác thực chính thức</span>
                        </div>
                        <div className="flex flex-col items-center p-4 rounded-xl bg-[#0a0a0a] border border-line">
                            <Layers className="w-5 h-5 text-white mb-2" />
                            <span className="font-semibold text-white">Multi-Tenant</span>
                            <span className="text-[11px] text-neutral-500 mt-0.5">Cô lập dữ liệu client</span>
                        </div>
                        <div className="flex flex-col items-center p-4 rounded-xl bg-[#0a0a0a] border border-line">
                            <RefreshCw className="w-5 h-5 text-white mb-2" />
                            <span className="font-semibold text-white">Napas 24/7 &amp; VAT</span>
                            <span className="text-[11px] text-neutral-500 mt-0.5">Xuất hóa đơn đỏ</span>
                        </div>
                    </div>
                </div>

                <div className="mt-24 max-w-3xl mx-auto w-full">
                    <div className="text-center mb-10">
                        <h3 className="text-2xl font-bold text-white">
                            {payCurrency === "VND" ? "Câu hỏi thường gặp" : "Frequently Asked Questions"}
                        </h3>
                        <p className="text-xs text-neutral-400 mt-1">
                            {payCurrency === "VND" ? "Mọi điều bạn cần biết về dịch vụ và thanh toán" : "Everything you need to know about plans and billing"}
                        </p>
                    </div>

                    <div className="space-y-3">
                        {faqs.map((faq, idx) => {
                            const isOpen = openFaq === idx;
                            return (
                                <div
                                    key={idx}
                                    className="rounded-xl bg-[#0a0a0a] border border-line overflow-hidden transition-colors"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setOpenFaq(isOpen ? null : idx)}
                                        className="w-full px-6 py-4 flex items-center justify-between text-left font-medium text-sm text-white hover:text-white transition-colors"
                                    >
                                        <span>{faq.q}</span>
                                        <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${isOpen ? "rotate-180 text-white" : ""}`} />
                                    </button>
                                    {isOpen && (
                                        <div className="px-6 pb-4 text-xs text-neutral-400 leading-relaxed border-t border-line pt-3">
                                            {faq.a}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>

            {/* VietQR Modal */}
            <VietQrModal
                isOpen={qrModalOpen}
                onClose={() => setQrModalOpen(false)}
                planName={selectedQrPlan.name}
                planDisplayName={selectedQrPlan.displayName}
                amountVnd={selectedQrPlan.amount}
                billingCycle={isAnnual ? "annual" : "monthly"}
            />
        </div>
    );
}
