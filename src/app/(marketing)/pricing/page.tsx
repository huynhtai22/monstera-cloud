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
} from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { VietQrModal } from "@/components/pricing/VietQrModal";
import { useState, useEffect } from "react";
import { metaPixelCustom } from "@/lib/meta-pixel";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { PLAN_PRICING, type PlanName } from "@/lib/plan-config";

const PLAN_SOURCES = {
    starter: [
        { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
    ],
    pro: [
        { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
    ],
    enterprise: [
        { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
    ],
};

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);
    const [payCurrency, setPayCurrency] = useState<"VND" | "USD">("USD");
    const [currencyReady, setCurrencyReady] = useState(false);
    const [regionHint, setRegionHint] = useState<string | null>(null);

    // FAQ Accordion state
    const [openFaq, setOpenFaq] = useState<number | null>(null);

    // VietQR Modal State
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const [selectedQrPlan, setSelectedQrPlan] = useState<{
        name: string;
        displayName: string;
        amount: number;
    }>({
        name: "starter",
        displayName: "Starter",
        amount: 490000,
    });

    // Auto-detect geo using fast internal edge route (/api/geo)
    useEffect(() => {
        fetch("/api/geo")
            .then((r) => r.json())
            .then((data: { country?: string; city?: string; currency?: string; isVietnam?: boolean }) => {
                const detectedCurrency = data.currency === "VND" || data.isVietnam ? "VND" : "USD";
                setPayCurrency(detectedCurrency);
                const city = data.city && String(data.city).trim();
                setRegionHint(
                    city ? city : data.isVietnam ? "Việt Nam (Ưu đãi PPP)" : data.country || null
                );
            })
            .catch(() => {
                setPayCurrency("USD");
                setRegionHint(null);
            })
            .finally(() => setCurrencyReady(true));
    }, []);

    const getPlanPriceDisplay = (plan: PlanName) => {
        const cfg = PLAN_PRICING[plan] || PLAN_PRICING.free;
        if (payCurrency === "VND") {
            const amount = isAnnual ? cfg.vndAnnualMonthly : cfg.vndMonthly;
            const annualTotal = cfg.vndAnnualMonthly * 12;
            const annualSaving = (cfg.vndMonthly - cfg.vndAnnualMonthly) * 12;
            return {
                amount,
                amountFormatted: amount.toLocaleString("vi-VN"),
                currencySymbol: "đ",
                unit: "/tháng",
                billingNote: isAnnual
                    ? `Thanh toán 1 năm (tiết kiệm 20%) · ${annualTotal.toLocaleString("vi-VN")} đ/năm`
                    : "Thanh toán từng tháng",
                savingBadge: isAnnual ? `Tiết kiệm ${annualSaving.toLocaleString("vi-VN")} đ/năm` : null,
            };
        }
        const amount = isAnnual ? cfg.usdAnnualMonthly : cfg.usdMonthly;
        const annualTotal = cfg.usdAnnualMonthly * 12;
        const annualSaving = (cfg.usdMonthly - cfg.usdAnnualMonthly) * 12;
        return {
            amount,
            amountFormatted: `$${amount}`,
            currencySymbol: "",
            unit: "/mo",
            billingNote: isAnnual
                ? `Billed annually (save 20%) · $${annualTotal}/year`
                : "Billed monthly",
            savingBadge: isAnnual ? `Save $${annualSaving}/year` : null,
        };
    };

    const openVietQr = (plan: PlanName, displayName: string) => {
        const cfg = PLAN_PRICING[plan];
        const monthlyAmount = isAnnual ? cfg.vndAnnualMonthly : cfg.vndMonthly;
        const totalAmount = isAnnual ? monthlyAmount * 12 : monthlyAmount;
        setSelectedQrPlan({
            name: plan,
            displayName,
            amount: totalAmount,
        });
        setQrModalOpen(true);
        metaPixelCustom("MC_Pricing_VietQR_Open", {
            plan,
            billing_cycle: isAnnual ? "annual" : "monthly",
            amount: totalAmount,
        });
    };

    const starterPricing = getPlanPriceDisplay("starter");
    const proPricing = getPlanPriceDisplay("professional");
    const enterprisePricing = getPlanPriceDisplay("enterprise");

    const faqs = [
        {
            q: payCurrency === "VND" ? "Monstera Cloud có hỗ trợ xuất hóa đơn VAT không?" : "Do you provide corporate VAT invoices and tax documentation?",
            a: payCurrency === "VND"
                ? "Có! Monstera Cloud hỗ trợ xuất hóa đơn điện tử VAT đầy đủ cho doanh nghiệp và Agency tại Việt Nam đối với tất cả các gói dịch vụ (chọn hình thức thanh toán VietQR / Chuyển khoản ngân hàng)."
                : "Yes, all international transactions processed via Paddle include standard compliant commercial VAT/GST invoices for your company accounting.",
        },
        {
            q: payCurrency === "VND" ? "Tôi có thể kết nối bao nhiêu tài khoản quảng cáo?" : "How many ad accounts can I connect?",
            a: payCurrency === "VND"
                ? "Gói Starter hỗ trợ tới 5 tài khoản quảng cáo & gian hàng. Gói Agency Pro hỗ trợ tới 20 tài khoản (kết hợp tự do giữa Meta, Google, TikTok và Shopee). Gói Enterprise hỗ trợ không giới hạn."
                : "Starter supports up to 5 accounts, Agency Pro supports up to 20 accounts across Meta, Google, TikTok, and Shopee. Enterprise includes custom unlimited capacity.",
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
        <div className="min-h-screen pt-28 pb-24 bg-canvas font-sans text-ink antialiased selection:bg-accent/20 selection:text-ink">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* ── Top Header Section ────────────────────────────────────────────── */}
                <div className="text-center max-w-3xl mx-auto pt-6 mb-12">
                    <div className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold text-ink border border-line bg-panel mb-6">
                        <Sparkles className="w-3.5 h-3.5 text-accent" />
                        <span>{payCurrency === "VND" ? "Bảng Giá Minh Bạch · Không Phí Ẩn" : "Transparent Pricing · Zero Hidden Fees"}</span>
                    </div>

                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-ink leading-[1.15]">
                        {payCurrency === "VND" ? (
                            <>
                                Tự động hóa báo cáo Ads. <br />
                                <span className="text-accent">
                                    Tiết kiệm 80% chi phí.
                                </span>
                            </>
                        ) : (
                            <>
                                Unified Ads Reporting. <br />
                                <span className="text-accent">
                                    One Flat Subscription.
                                </span>
                            </>
                        )}
                    </h1>

                    <p className="mt-5 text-base sm:text-lg text-ink-mute font-normal max-w-2xl mx-auto leading-relaxed">
                        {payCurrency === "VND"
                            ? "Kéo dữ liệu Meta Ads, Google Ads, TikTok Ads và Shopee trực tiếp vào Google Sheets & Looker Studio. Hỗ trợ thanh toán VietQR và xuất hóa đơn VAT."
                            : "Stream performance data from Meta, Google, TikTok, and Shopee straight into Google Sheets and Looker Studio. No row limits, no complex setups."}
                    </p>
                </div>

                {/* ── Control Bar: Billing Cycle & Currency Switcher ─────────────────── */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
                    {/* Billing Toggle */}
                    <div className="inline-flex p-1 rounded-lg bg-panel border border-line">
                        <button
                            type="button"
                            onClick={() => setIsAnnual(false)}
                            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                                !isAnnual
                                    ? "bg-white text-black shadow-xs"
                                    : "text-ink-mute hover:text-ink"
                            }`}
                        >
                            {payCurrency === "VND" ? "Thanh toán theo tháng" : "Monthly billing"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsAnnual(true)}
                            className={`px-4 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                                isAnnual
                                    ? "bg-white text-black shadow-xs"
                                    : "text-ink-mute hover:text-ink"
                            }`}
                        >
                            <span>{payCurrency === "VND" ? "Thanh toán theo năm" : "Annual billing"}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-canvas text-accent border border-line">
                                −20%
                            </span>
                        </button>
                    </div>

                    {/* Currency Selector */}
                    {currencyReady && (
                        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-panel border border-line text-xs">
                            <button
                                type="button"
                                onClick={() => setPayCurrency("VND")}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                                    payCurrency === "VND"
                                        ? "bg-white text-black shadow-xs"
                                        : "text-ink-mute hover:text-ink"
                                }`}
                            >
                                <span>🇻🇳</span>
                                <span>VNĐ</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setPayCurrency("USD")}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                                    payCurrency === "USD"
                                        ? "bg-white text-black shadow-xs"
                                        : "text-ink-mute hover:text-ink"
                                }`}
                            >
                                <span>🌍</span>
                                <span>USD ($)</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Polished 3-Pillar Pricing Grid ─────────────────────────────────── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto items-stretch">

                    {/* ── PILLAR 1: STARTER ────────────────────────────────────────────── */}
                    <div className="relative rounded-lg p-6 md:p-8 bg-panel border border-line flex flex-col justify-between transition-colors hover:border-[#333]">
                        <div className="flex flex-col">
                            {/* Plan Header */}
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xl font-bold text-ink tracking-tight">Starter</h3>
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded bg-canvas text-ink-mute border border-line">
                                    Solo &amp; Freelancer
                                </span>
                            </div>

                            <p className="text-xs text-ink-mute mb-6 leading-relaxed min-h-[36px]">
                                {payCurrency === "VND"
                                    ? "Dành cho Media Buyer cá nhân, nhà bán lẻ và chủ shop tự vận hành báo cáo hàng ngày."
                                    : "For solo media buyers, indie marketers, and shop owners automating their daily reports."}
                            </p>

                            {/* Price Hero Section */}
                            <div className="mb-6 space-y-1.5">
                                <div className="flex items-baseline gap-1 whitespace-nowrap">
                                    <span className="text-3xl md:text-4xl font-bold tracking-tight text-ink">
                                        {starterPricing.amountFormatted}
                                    </span>
                                    {starterPricing.currencySymbol ? (
                                        <span className="text-lg md:text-xl font-bold text-ink-mute">
                                            {starterPricing.currencySymbol}
                                        </span>
                                    ) : null}
                                    <span className="text-sm font-normal text-ink-mute">
                                        {starterPricing.unit}
                                    </span>
                                </div>
                                <p className="text-xs text-ink-mute">
                                    {starterPricing.billingNote}
                                </p>
                            </div>

                            {/* CTA Action Button */}
                            {payCurrency === "VND" ? (
                                <button
                                    onClick={() => openVietQr("starter", "Starter")}
                                    className="w-full py-3 px-4 rounded-md bg-white hover:bg-neutral-200 text-black font-semibold text-xs transition-colors flex items-center justify-center gap-2 mb-6"
                                >
                                    <QrCode className="w-4 h-4 text-emerald-600" />
                                    <span>Thanh toán VietQR (Napas 24/7)</span>
                                </button>
                            ) : (
                                <CheckoutButton
                                    plan="starter"
                                    billingCycle={isAnnual ? "annual" : "monthly"}
                                    invoiceCurrency={payCurrency}
                                    metaPixelEvent="MC_Pricing_Starter_Checkout"
                                    metaPixelParams={{ billing_cycle: isAnnual ? "annual" : "monthly", currency: payCurrency }}
                                    className="w-full py-3 px-4 rounded-md bg-white hover:bg-neutral-200 text-black font-semibold text-xs transition-colors flex items-center justify-center gap-2 mb-6"
                                >
                                    <span>Get Started</span>
                                    <ArrowRight className="w-4 h-4" />
                                </CheckoutButton>
                            )}

                            {/* Channel Badges */}
                            <div className="pt-4 border-t border-line mb-6">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute block mb-3">
                                    {payCurrency === "VND" ? "Kênh hỗ trợ kết nối" : "Supported Channels"}
                                </span>
                                <div className="flex items-center gap-2.5">
                                    {PLAN_SOURCES.starter.map((s) => (
                                        <IntegrationMark key={s.alt} src={s.src} alt={s.alt} size="sm" />
                                    ))}
                                </div>
                            </div>

                            {/* Feature List */}
                            <div className="space-y-3 pt-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute block">
                                    {payCurrency === "VND" ? "Quyền lợi gói Starter" : "What's included"}
                                </span>
                                <ul className="space-y-2.5 text-xs text-ink-mute">
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span><strong className="text-ink">1 Tài khoản quản trị</strong> (Google Workspace)</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span><strong className="text-ink">Tối đa 5 Ad Accounts &amp; Shops</strong> (Meta, Google, TikTok, Shopee)</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span><strong className="text-ink">500 Lượt làm mới / tháng</strong></span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span>Google Sheets™ Add-on &amp; Looker Studio</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span>Lịch tự động làm mới hàng ngày</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* ── PILLAR 2: AGENCY PRO (Hero / Highlighted Card) ───────────────── */}
                    <div className="relative rounded-lg p-6 md:p-8 bg-panel border border-accent/40 ring-1 ring-accent/20 flex flex-col justify-between shadow-sm transition-colors hover:border-accent/60">
                        {/* Top Floating Badge */}
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-canvas border border-accent/40 text-accent text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap">
                            <Sparkles className="w-3 h-3" />
                            <span>{payCurrency === "VND" ? "✦ Lựa chọn phổ biến nhất" : "✦ Most Popular"}</span>
                        </div>

                        <div className="flex flex-col">
                            {/* Plan Header */}
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xl font-bold text-ink tracking-tight flex items-center gap-2">
                                    Agency Pro
                                </h3>
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded bg-canvas text-accent border border-accent/30">
                                    Agency &amp; Growth
                                </span>
                            </div>

                            <p className="text-xs text-ink-mute mb-6 leading-relaxed min-h-[36px]">
                                {payCurrency === "VND"
                                    ? "Giải pháp hoàn chỉnh cho Marketing Agency, Team chạy Ads và Enabler quản lý nhiều khách hàng."
                                    : "Designed for performance agencies and brand enablers managing multi-client ad accounts."}
                            </p>

                            {/* Price Hero Section */}
                            <div className="mb-6 space-y-1.5">
                                <div className="flex items-baseline gap-1 whitespace-nowrap">
                                    <span className="text-3xl md:text-4xl font-bold tracking-tight text-ink">
                                        {proPricing.amountFormatted}
                                    </span>
                                    {proPricing.currencySymbol ? (
                                        <span className="text-lg md:text-xl font-bold text-accent">
                                            {proPricing.currencySymbol}
                                        </span>
                                    ) : null}
                                    <span className="text-sm font-normal text-accent">
                                        {proPricing.unit}
                                    </span>
                                </div>
                                <p className="text-xs text-ink-mute">
                                    {proPricing.billingNote}
                                </p>
                            </div>

                            {/* CTA Action Button */}
                            {payCurrency === "VND" ? (
                                <button
                                    onClick={() => openVietQr("professional", "Agency Pro")}
                                    className="w-full py-3 px-4 rounded-md bg-white hover:bg-neutral-200 text-black font-semibold text-xs transition-colors flex items-center justify-center gap-2 mb-6 shadow-sm"
                                >
                                    <QrCode className="w-4 h-4 text-emerald-600" />
                                    <span>Thanh toán VietQR (Kích hoạt ngay)</span>
                                </button>
                            ) : (
                                <CheckoutButton
                                    plan="professional"
                                    billingCycle={isAnnual ? "annual" : "monthly"}
                                    invoiceCurrency={payCurrency}
                                    metaPixelEvent="MC_Pricing_Pro_Checkout"
                                    metaPixelParams={{ billing_cycle: isAnnual ? "annual" : "monthly", currency: payCurrency }}
                                    className="w-full py-3 px-4 rounded-md bg-white hover:bg-neutral-200 text-black font-semibold text-xs transition-colors flex items-center justify-center gap-2 mb-6 shadow-sm"
                                >
                                    <span>Start 14-Day Pilot</span>
                                    <ArrowRight className="w-4 h-4" />
                                </CheckoutButton>
                            )}

                            {/* Channel Badges */}
                            <div className="pt-4 border-t border-line mb-6">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute block mb-3">
                                    {payCurrency === "VND" ? "Đầy đủ tất cả nền tảng" : "All Platforms Included"}
                                </span>
                                <div className="flex items-center gap-2.5">
                                    {PLAN_SOURCES.pro.map((s) => (
                                        <IntegrationMark key={s.alt} src={s.src} alt={s.alt} size="sm" />
                                    ))}
                                </div>
                            </div>

                            {/* Feature List */}
                            <div className="space-y-3 pt-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-accent block">
                                    {payCurrency === "VND" ? "Bao gồm quyền lợi Starter, cộng thêm:" : "Everything in Starter, plus:"}
                                </span>
                                <ul className="space-y-2.5 text-xs text-ink-mute">
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                        <span><strong className="text-ink">3 Thành viên nhóm</strong> (Thêm user dễ dàng)</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                        <span><strong className="text-ink">Tối đa 20 Accounts &amp; Shops</strong> (Meta + TikTok + Shopee + Google)</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                        <span><strong className="text-ink">3.000 Lượt làm mới / tháng</strong> + Băng thông ưu tiên</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                        <span>Phân quyền Workspace riêng biệt cho từng Client</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                        <span>Lịch tự động làm mới theo giờ &amp; theo đêm</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                        <span>Hỗ trợ kỹ thuật 1-1 qua Zalo / Telegram</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* ── PILLAR 3: ENTERPRISE ────────────────────────────────────────── */}
                    <div className="relative rounded-lg p-6 md:p-8 bg-panel border border-line flex flex-col justify-between transition-colors hover:border-[#333]">
                        <div className="flex flex-col">
                            {/* Plan Header */}
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xl font-bold text-ink tracking-tight">Enterprise</h3>
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded bg-canvas text-ink-mute border border-line">
                                    Quy mô lớn
                                </span>
                            </div>

                            <p className="text-xs text-ink-mute mb-6 leading-relaxed min-h-[36px]">
                                {payCurrency === "VND"
                                    ? "Dành cho Agency lớn, Tập đoàn bán lẻ và doanh nghiệp cần kho dữ liệu BigQuery / PostgreSQL riêng."
                                    : "For large agencies and brands needing dedicated cloud warehousing, custom integrations, and SLA."}
                            </p>

                            {/* Price Hero Section */}
                            <div className="mb-6 space-y-1.5">
                                <div className="flex items-baseline gap-1 whitespace-nowrap">
                                    <span className="text-3xl md:text-4xl font-bold tracking-tight text-ink">
                                        {enterprisePricing.amountFormatted}
                                    </span>
                                    {enterprisePricing.currencySymbol ? (
                                        <span className="text-lg md:text-xl font-bold text-ink-mute">
                                            {enterprisePricing.currencySymbol}
                                        </span>
                                    ) : null}
                                    <span className="text-sm font-normal text-ink-mute">
                                        {enterprisePricing.unit}
                                    </span>
                                </div>
                                <p className="text-xs text-ink-mute">
                                    {enterprisePricing.billingNote}
                                </p>
                            </div>

                            {/* CTA Action Button */}
                            <Link
                                href="mailto:support@monsteracloud.com?subject=Inquiry%20Enterprise%20Plan%20Monstera%20Cloud"
                                className="w-full py-3 px-4 rounded-md border border-line bg-canvas hover:bg-[#16181c] text-ink font-semibold text-xs transition-colors flex items-center justify-center gap-2 mb-6"
                            >
                                <Building2 className="w-4 h-4 text-ink-mute" />
                                <span>{payCurrency === "VND" ? "Liên hệ tư vấn Enterprise" : "Contact Sales"}</span>
                            </Link>

                            {/* Channel Badges */}
                            <div className="pt-4 border-t border-line mb-6">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute block mb-3">
                                    {payCurrency === "VND" ? "Không giới hạn kênh & tài khoản" : "Unlimited Custom Channels"}
                                </span>
                                <div className="flex items-center gap-2.5">
                                    {PLAN_SOURCES.enterprise.map((s) => (
                                        <IntegrationMark key={s.alt} src={s.src} alt={s.alt} size="sm" />
                                    ))}
                                </div>
                            </div>

                            {/* Feature List */}
                            <div className="space-y-3 pt-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute block">
                                    {payCurrency === "VND" ? "Đặc quyền Enterprise" : "Enterprise features"}
                                </span>
                                <ul className="space-y-2.5 text-xs text-ink-mute">
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span><strong className="text-ink">Không giới hạn tài khoản &amp; Pipelines</strong></span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span><strong className="text-ink">10+ User Seats</strong> tùy chỉnh theo nhu cầu</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span>Dedicated Database Warehouse (PostgreSQL / BigQuery)</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span>Hợp đồng dịch vụ doanh nghiệp (SLA 99.9%)</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        <span>Xuất hóa đơn điện tử VAT hàng tháng</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>

                </div>

                {/* ── Enterprise Custom Banner ────────────────────────────────────────── */}
                <div className="mt-16 max-w-4xl mx-auto rounded-lg p-6 bg-panel border border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
                    <div>
                        <h4 className="font-bold text-sm text-ink">
                            {payCurrency === "VND" ? "Bạn cần tư vấn giải pháp đo lường dữ liệu riêng?" : "Looking for custom data engineering or bespoke setup?"}
                        </h4>
                        <p className="text-xs text-ink-mute mt-1">
                            {payCurrency === "VND"
                                ? "Đội ngũ kỹ thuật của Monstera Cloud sẵn sàng hỗ trợ setup và đào tạo trực tiếp cho Agency của bạn."
                                : "Our engineering team provides direct onboarding, custom connector development, and dedicated warehouse support."}
                        </p>
                    </div>
                    <Link
                        href="mailto:support@monsteracloud.com"
                        className="px-4 py-2 rounded-md bg-canvas border border-line text-xs font-semibold text-ink hover:bg-[#16181c] transition-colors whitespace-nowrap"
                    >
                        {payCurrency === "VND" ? "Gặp chuyên gia tư vấn" : "Talk to Sales"}
                    </Link>
                </div>

                {/* ── Security Trust Grid ────────────────────────────────────────────── */}
                <div className="mt-20 pt-10 border-t border-line text-center">
                    <p className="text-xs font-bold uppercase tracking-widest text-ink-mute mb-8">
                        {payCurrency === "VND" ? "Tiêu chuẩn an toàn & Bảo mật quốc tế" : "Enterprise Security Standards"}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto text-xs text-ink-mute">
                        <div className="flex flex-col items-center p-4 rounded-lg bg-panel border border-line">
                            <Lock className="w-5 h-5 text-accent mb-2" />
                            <span className="font-semibold text-ink">AES-256-GCM</span>
                            <span className="text-[11px] text-ink-mute mt-0.5">Mã hóa dữ liệu 2 lớp</span>
                        </div>
                        <div className="flex flex-col items-center p-4 rounded-lg bg-panel border border-line">
                            <ShieldCheck className="w-5 h-5 text-accent mb-2" />
                            <span className="font-semibold text-ink">Google OAuth 2.0</span>
                            <span className="text-[11px] text-ink-mute mt-0.5">Xác thực chính thức</span>
                        </div>
                        <div className="flex flex-col items-center p-4 rounded-lg bg-panel border border-line">
                            <Layers className="w-5 h-5 text-accent mb-2" />
                            <span className="font-semibold text-ink">Multi-Tenant</span>
                            <span className="text-[11px] text-ink-mute mt-0.5">Cô lập dữ liệu client</span>
                        </div>
                        <div className="flex flex-col items-center p-4 rounded-lg bg-panel border border-line">
                            <RefreshCw className="w-5 h-5 text-accent mb-2" />
                            <span className="font-semibold text-ink">Napas 24/7 &amp; VAT</span>
                            <span className="text-[11px] text-ink-mute mt-0.5">Xuất hóa đơn đỏ</span>
                        </div>
                    </div>
                </div>

                {/* ── FAQ Section (Clean Minimalist Accordion) ────────────────────────── */}
                <div className="mt-24 max-w-3xl mx-auto">
                    <div className="text-center mb-10">
                        <h3 className="text-2xl font-bold text-ink">
                            {payCurrency === "VND" ? "Câu hỏi thường gặp" : "Frequently Asked Questions"}
                        </h3>
                        <p className="text-xs text-ink-mute mt-1">
                            {payCurrency === "VND" ? "Mọi điều bạn cần biết về dịch vụ và thanh toán" : "Everything you need to know about plans and billing"}
                        </p>
                    </div>

                    <div className="space-y-3">
                        {faqs.map((faq, idx) => {
                            const isOpen = openFaq === idx;
                            return (
                                <div
                                    key={idx}
                                    className="rounded-lg bg-panel border border-line overflow-hidden transition-colors"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setOpenFaq(isOpen ? null : idx)}
                                        className="w-full px-6 py-4 flex items-center justify-between text-left font-medium text-sm text-ink hover:text-white transition-colors"
                                    >
                                        <span>{faq.q}</span>
                                        <ChevronDown className={`w-4 h-4 text-ink-mute transition-transform duration-200 ${isOpen ? "rotate-180 text-ink" : ""}`} />
                                    </button>
                                    {isOpen && (
                                        <div className="px-6 pb-4 text-xs text-ink-mute leading-relaxed border-t border-line pt-3">
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
