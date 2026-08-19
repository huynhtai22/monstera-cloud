"use client";

import Link from "next/link";
import { Check, CheckCircle2, Shield, ShieldCheck, Zap, MapPin, QrCode, CreditCard } from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { VietQrModal } from "@/components/pricing/VietQrModal";
import { MarketingTrustSecuritySection } from "@/components/marketing/MarketingTrustSecuritySection";
import { useState, useEffect } from "react";
import { metaPixelCustom } from "@/lib/meta-pixel";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { PLAN_PRICING, type PlanName } from "@/lib/plan-config";

const PLAN_SOURCES = {
    free: [
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
    ],
    starter: [
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
        { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
        { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
    ],
    pro: [
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
        { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
        { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
    ],
};

const PLAN_DESTINATIONS = [
    { src: INTEGRATION_LOGOS.googleSheets, alt: "Google Sheets" },
    { src: INTEGRATION_LOGOS.looker, alt: "Looker Studio" },
];

function PlatformBadges({ sources, showDestinations = true }: { sources: { src: string; alt: string }[]; showDestinations?: boolean }) {
    return (
        <div className="mb-5">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-2">Sources</p>
            <div className="flex items-center gap-2 mb-3">
                {sources.map(({ src, alt }) => (
                    <img key={alt} src={src} alt={alt} title={alt} className="w-5 h-5 object-contain opacity-70 hover:opacity-100 transition-opacity" />
                ))}
                {sources.length < 5 && <span className="text-[10px] text-slate-300">+ more coming</span>}
            </div>
            {showDestinations && (
                <>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-2">Destinations</p>
                    <div className="flex items-center gap-2">
                        {PLAN_DESTINATIONS.map(({ src, alt }) => (
                            <img key={alt} src={src} alt={alt} title={alt} className="w-5 h-5 object-contain opacity-70 hover:opacity-100 transition-opacity" />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function FeatureItem({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
    return (
        <li className="flex items-start gap-2 text-xs text-slate-600">
            <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${accent ? "text-cyan-500" : "text-slate-400"}`} />
            <span>{children}</span>
        </li>
    );
}

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);
    const [payCurrency, setPayCurrency] = useState<"VND" | "USD">("USD");
    const [currencyReady, setCurrencyReady] = useState(false);
    const [regionHint, setRegionHint] = useState<string | null>(null);

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
                    city ? city : data.isVietnam ? "Việt Nam (Ưu đãi nội địa)" : data.country || null
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
            return {
                amount,
                text: `${amount.toLocaleString("vi-VN")} đ`,
                saving: isAnnual ? `${((cfg.vndMonthly - cfg.vndAnnualMonthly) * 12).toLocaleString("vi-VN")} đ` : null,
            };
        }
        const amount = isAnnual ? cfg.usdAnnualMonthly : cfg.usdMonthly;
        return {
            amount,
            text: `$${amount}`,
            saving: isAnnual ? `$${(cfg.usdMonthly - cfg.usdAnnualMonthly) * 12}` : null,
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
    const priceClass = "transition-all duration-300";

    return (
        <div className="min-h-screen pt-32 pb-24 bg-white font-sans">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* Header */}
                <div className="text-center mb-14">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-cyan-600 border border-cyan-200 bg-cyan-50 tracking-widest uppercase mb-5">
                        Bảng Giá &amp; Gói Dịch Vụ
                    </div>
                    <h1 className="text-slate-900 text-4xl md:text-5xl font-extrabold leading-tight tracking-tight">
                        {payCurrency === "VND"
                            ? "Một mức giá phẳng. Đầy đủ nền tảng. Không giới hạn số dòng."
                            : "One flat price. Every platform. No permanent row caps."}
                    </h1>
                    <p className="text-slate-500 text-lg max-w-xl mx-auto mt-4">
                        {payCurrency === "VND"
                            ? "Tiết kiệm 80% chi phí so với Supermetrics. Hỗ trợ thanh toán VietQR & Xuất hóa đơn VAT đầy đủ."
                            : "Most teams save $2,400/year vs Supermetrics on Pro. Cancel anytime."}
                    </p>
                </div>

                {/* Billing Toggle & Currency Switcher */}
                <div className="flex flex-col items-center gap-3 mb-8">
                    <div className="flex p-1 bg-slate-100 border border-gray-200 rounded-lg w-[240px] text-sm font-medium">
                        <button
                            onClick={() => setIsAnnual(false)}
                            className={`flex h-9 flex-1 items-center justify-center rounded-md transition-all ${
                                !isAnnual ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                            }`}
                        >
                            {payCurrency === "VND" ? "Theo tháng" : "Monthly"}
                        </button>
                        <button
                            onClick={() => setIsAnnual(true)}
                            className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md transition-all ${
                                isAnnual ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                            }`}
                        >
                            {payCurrency === "VND" ? "Theo năm" : "Annual"}
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-600 font-bold border border-cyan-200">
                                −20%
                            </span>
                        </button>
                    </div>

                    {/* Currency Switcher Bar */}
                    {currencyReady && (
                        <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            {regionHint && <span className="text-slate-600 font-semibold">{regionHint}</span>}
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-500">Tiền tệ:</span>
                            <div className="inline-flex rounded-md p-0.5 bg-slate-200/70 text-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setPayCurrency("VND")}
                                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                                        payCurrency === "VND" ? "bg-white text-emerald-700 shadow-xs" : "text-slate-500 hover:text-slate-900"
                                    }`}
                                >
                                    🇻🇳 VNĐ
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPayCurrency("USD")}
                                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                                        payCurrency === "USD" ? "bg-white text-blue-700 shadow-xs" : "text-slate-500 hover:text-slate-900"
                                    }`}
                                >
                                    🌍 USD
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Pricing Cards */}
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">

                    {/* Free Tier */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col hover:border-gray-300 transition-colors shadow-sm">
                        <div className="mb-4">
                            <h3 className="text-slate-900 text-lg font-bold">Free Trial</h3>
                            <p className="text-slate-400 text-sm mt-0.5">Không cần thẻ tín dụng</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-4xl font-extrabold text-slate-900">
                                {payCurrency === "VND" ? "0 đ" : "$0"}
                            </span>
                            <p className="text-slate-400 text-xs mt-1">miễn phí trải nghiệm</p>
                        </div>
                        <Link
                            href="/sources"
                            onClick={() =>
                                metaPixelCustom("MC_Pricing_Free_GetStarted", {
                                    plan: "free",
                                    billing_cycle: isAnnual ? "annual" : "monthly",
                                    currency: payCurrency,
                                })
                            }
                            className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold text-center hover:bg-slate-800 transition-colors mb-6"
                        >
                            Bắt đầu miễn phí
                        </Link>
                        <PlatformBadges sources={PLAN_SOURCES.free} />
                        <div className="border-t border-gray-100 pt-4 flex-1">
                            <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest mb-3">Tính năng bao gồm</p>
                            <ul className="space-y-2">
                                <FeatureItem>2 kết nối ad accounts</FeatureItem>
                                <FeatureItem>Đồng bộ dữ liệu hàng ngày</FeatureItem>
                                <FeatureItem>Lịch sử báo cáo 14 ngày</FeatureItem>
                                <FeatureItem>Kết nối TikTok Ads &amp; Shopee</FeatureItem>
                                <FeatureItem>Google Sheets™ Add-on</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Starter Tier */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col hover:border-gray-300 transition-colors shadow-sm">
                        <div className="mb-4">
                            <h3 className="text-slate-900 text-lg font-bold">Starter</h3>
                            <p className="text-slate-400 text-sm mt-0.5">Solo Media Buyer &amp; Chủ Shop</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-4xl font-extrabold text-slate-900">
                                {starterPricing.text}
                            </span>
                            <p className="text-slate-400 text-xs mt-1">
                                1 tài khoản quản trị / tháng
                                {starterPricing.saving && (
                                    <span className="text-cyan-600 ml-1 block sm:inline">· tiết kiệm {starterPricing.saving}/năm</span>
                                )}
                            </p>
                        </div>

                        {/* Payment Button: VietQR if VND, Paddle Checkout if USD */}
                        {payCurrency === "VND" ? (
                            <button
                                onClick={() => openVietQr("starter", "Starter")}
                                className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold text-center hover:bg-emerald-700 transition-all mb-2 flex items-center justify-center gap-2 shadow-sm"
                            >
                                <QrCode className="w-4 h-4" />
                                Thanh toán VietQR (Napas 24/7)
                            </button>
                        ) : (
                            <CheckoutButton
                                plan="starter"
                                billingCycle={isAnnual ? "annual" : "monthly"}
                                invoiceCurrency={payCurrency}
                                metaPixelEvent="MC_Pricing_Starter_Checkout"
                                metaPixelParams={{
                                    billing_cycle: isAnnual ? "annual" : "monthly",
                                    currency: payCurrency,
                                }}
                                className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold text-center hover:bg-slate-800 transition-colors mb-2"
                            >
                                Get Starter
                            </CheckoutButton>
                        )}

                        <p className="text-slate-400 text-[10px] text-center mb-6">
                            Bao gồm 14 ngày dùng thử đầy đủ tính năng
                        </p>
                        <PlatformBadges sources={PLAN_SOURCES.starter} />
                        <div className="border-t border-gray-100 pt-4 flex-1">
                            <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest mb-3">Tính năng gói Starter</p>
                            <ul className="space-y-2">
                                <FeatureItem><strong>1 User Seat</strong> (Google Account)</FeatureItem>
                                <FeatureItem><strong>Tối đa 5 Accounts &amp; Shops</strong> (Meta, Google, TikTok, Shopee)</FeatureItem>
                                <FeatureItem><strong>500 Lần truy vấn / tháng</strong></FeatureItem>
                                <FeatureItem>Google Sheets™ Add-on &amp; Looker Studio</FeatureItem>
                                <FeatureItem>Tự động cập nhật số liệu mỗi ngày</FeatureItem>
                                <FeatureItem>Hỗ trợ qua Zalo &amp; Email</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Agency Pro — Hero Card */}
                    <div className="relative bg-white border-2 border-cyan-500 rounded-2xl p-8 flex flex-col shadow-xl shadow-cyan-500/10 ring-1 ring-cyan-500/20">
                        <div className="mb-4">
                            <div className="flex items-center gap-2.5">
                                <h3 className="text-slate-900 text-xl font-bold">Agency Pro</h3>
                                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 uppercase tracking-wider">
                                    Khuyên dùng
                                </span>
                            </div>
                            <p className="text-cyan-600 text-sm mt-0.5">Lựa chọn số 1 cho Agency &amp; Brand Enabler</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-5xl font-extrabold text-slate-900">
                                {proPricing.text}
                            </span>
                            <p className="text-slate-500 text-xs mt-1">
                                3 thành viên quản trị / tháng
                                {proPricing.saving && (
                                    <span className="text-cyan-600 ml-1 block sm:inline">· tiết kiệm {proPricing.saving}/năm</span>
                                )}
                            </p>
                        </div>

                        {/* Payment Button: VietQR if VND, Paddle Checkout if USD */}
                        {payCurrency === "VND" ? (
                            <button
                                onClick={() => openVietQr("professional", "Agency Pro")}
                                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-bold text-center transition-all mb-1 shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
                            >
                                <QrCode className="w-4 h-4" />
                                Thanh toán VietQR (Kích hoạt ngay)
                            </button>
                        ) : (
                            <CheckoutButton
                                plan="professional"
                                billingCycle={isAnnual ? "annual" : "monthly"}
                                invoiceCurrency={payCurrency}
                                metaPixelEvent="MC_Pricing_Pro_Checkout"
                                metaPixelParams={{
                                    billing_cycle: isAnnual ? "annual" : "monthly",
                                    currency: payCurrency,
                                }}
                                className="w-full py-3 rounded-xl bg-cyan-600 text-white text-sm font-bold text-center hover:bg-cyan-700 transition-colors mb-1 shadow-lg shadow-cyan-600/20"
                            >
                                Start Agency Pilot
                            </CheckoutButton>
                        )}

                        <p className="text-slate-400 text-[10px] text-center mb-6">
                            14 ngày dùng thử Agency Pilot miễn phí · Hỗ trợ xuất hóa đơn VAT
                        </p>
                        <PlatformBadges sources={PLAN_SOURCES.pro} />
                        <div className="border-t border-cyan-200 pt-4 flex-1">
                            <p className="text-cyan-600/70 text-[10px] font-semibold uppercase tracking-widest mb-3">Tất cả quyền lợi Starter, cộng thêm</p>
                            <ul className="space-y-2">
                                <FeatureItem accent><strong>3 Thành viên nhóm</strong> (Thêm user dễ dàng)</FeatureItem>
                                <FeatureItem accent><strong>Tối đa 20 Accounts &amp; Gian hàng Shopee</strong></FeatureItem>
                                <FeatureItem accent><strong>3.000 Lần truy vấn / tháng</strong> + Băng thông ưu tiên</FeatureItem>
                                <FeatureItem accent>Full Sàn Đông Nam Á (Shopee, Lazada, TikTok Shop)</FeatureItem>
                                <FeatureItem accent>Phân quyền workspace theo từng khách hàng</FeatureItem>
                                <FeatureItem accent>Tự động cập nhật số liệu theo giờ &amp; theo đêm</FeatureItem>
                                <FeatureItem accent>Hỗ trợ kỹ thuật 1-1 qua Zalo &amp; Telegram</FeatureItem>
                            </ul>
                        </div>
                    </div>

                </div>

                {/* Enterprise Contact Link */}
                <p className="mt-12 text-center text-sm text-slate-500">
                    Bạn cần quản lý trên 50+ tài khoản quảng cáo hoặc xuất hóa đơn VAT doanh nghiệp?{" "}
                    <Link
                        href="mailto:support@monsteracloud.com"
                        className="text-cyan-600 hover:text-cyan-700 underline underline-offset-2 font-semibold"
                    >
                        Liên hệ tư vấn gói Enterprise
                    </Link>
                </p>

                {/* Security and Trust Badges */}
                <div className="mt-14 text-center">
                    <p className="text-slate-400 text-xs uppercase tracking-widest font-semibold mb-5">Tiêu chuẩn an toàn &amp; Bảo mật</p>
                    <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-slate-500 text-sm">
                        {[
                            "Mã hóa bảo mật AES-256-GCM",
                            "Chuẩn xác thực Google OAuth 2.0",
                            "Google Sheets™ Add-on chính thức",
                            "Looker Studio Connector",
                            "Cô lập dữ liệu đa người dùng (Multi-tenant)",
                            "Hỗ trợ Napas 24/7 & Hóa đơn VAT",
                        ].map((item) => (
                            <span key={item} className="flex items-center gap-2">
                                <Check className="w-3.5 h-3.5 text-cyan-500" />
                                {item}
                            </span>
                        ))}
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
