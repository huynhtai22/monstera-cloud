"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Shield, Lock, Eye } from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";

const MARKETING_LANG_KEY = "marketing_lang";

// ─────────────────────────────────────────────
// Animated Stat — count-up on scroll into view
// ─────────────────────────────────────────────
function AnimatedStat({ value, label, delay = 0 }: { value: string; label: string; delay?: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [display, setDisplay] = useState("");

    // Detect when the element enters the viewport
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
            { threshold: 0.5 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Count-up animation
    useEffect(() => {
        if (!visible) return;

        // Parse: extract prefix, numeric part, suffix
        const match = value.match(/^([^0-9]*?)(\d+\.?\d*)(.*)$/);
        if (!match) {
            // Non-numeric value (e.g. "TLS 1.3") — just reveal
            const t = setTimeout(() => setDisplay(value), delay);
            return () => clearTimeout(t);
        }

        const [, prefix, numStr, suffix] = match;
        const target = parseFloat(numStr);
        const isFloat = numStr.includes(".");
        const duration = 1200; // ms
        const fps = 40;
        const steps = Math.ceil(duration / (1000 / fps));
        let step = 0;

        const t = setTimeout(() => {
            const interval = setInterval(() => {
                step++;
                const progress = Math.min(step / steps, 1);
                // ease-out quad
                const eased = 1 - (1 - progress) * (1 - progress);
                const current = eased * target;
                setDisplay(`${prefix}${isFloat ? current.toFixed(1) : Math.round(current)}${suffix}`);
                if (progress >= 1) clearInterval(interval);
            }, 1000 / fps);
        }, delay);

        return () => clearTimeout(t);
    }, [visible, value, delay]);

    return (
        <div ref={ref} className="text-center">
            <div
                className={`mb-1 font-mono text-2xl font-medium leading-none text-ink transition-all duration-500 ${
                    visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
                }`}
                style={{ transitionDelay: `${delay}ms` }}
            >
                {display || "\u00A0"}
            </div>
            <div
                className={`font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute transition-all duration-500 ${
                    visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                }`}
                style={{ transitionDelay: `${delay + 160}ms` }}
            >
                {label}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// Word Rotator
// ─────────────────────────────────────────────
function WordRotator({ words, interval = 2400 }: { words: readonly string[]; interval?: number }) {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setIndex(i => (i + 1) % words.length), interval);
        return () => clearInterval(id);
    }, [words.length, interval]);

    return (
        <span className="inline-flex overflow-hidden h-[1.15em] align-bottom relative">
            {words.map((word, i) => (
                <span
                    key={word}
                    className="absolute left-0 top-0 w-full transition-all duration-500 ease-in-out"
                    style={{
                        transform: i === index ? "translateY(0)" : i < index || (index === 0 && i === words.length - 1 && i !== 0) ? "translateY(-110%)" : "translateY(110%)",
                        opacity: i === index ? 1 : 0,
                    }}
                >
                    <span className="text-accent">{word}</span>
                </span>
            ))}
        </span>
    );
}

// ─────────────────────────────────────────────
// Copy — EN / VI
// ─────────────────────────────────────────────
const HERO_WORDS_EN = ["TikTok Ads", "Meta Ads", "Shopee", "Google Ads"] as const;
const HERO_WORDS_VI = ["TikTok Ads", "Meta Ads", "Shopee", "Google Ads"] as const;

const COPY = {
    en: {
        hero: {
            h1: ["Turn ad & marketplace data", "into client-ready reporting."],
            sub: "Monstera Cloud gives marketing agencies one unified warehouse to connect, normalize, and automate performance reporting across Meta, Google Ads, TikTok, and Shopee — without spreadsheet cleanup.",
            cta: "Start 14-day agency pilot",
            ctaSub: "Explore dashboard templates",
            trust: [
                { icon: Shield, text: "Multi-tenant workspace isolation" },
                { icon: Lock, text: "Read-only OAuth 2.0 · AES-256 encrypted" },
                { icon: Eye, text: "Looker Studio & Google Sheets™ delivery" },
            ],
        },
        how: {
            eyebrow: "The agency data engine",
            tabs: [
                { id: "connect", label: "1. Connect", icon: "plug", title: "Connect all client sources", body: "Authorize client Meta Ads, Google Ads, TikTok, and Shopee accounts in one click via read-only OAuth. Zero credential sharing.", detail: "Multi-client account selection · OAuth 2.0 only" },
                { id: "sync", label: "2. Normalize", icon: "refresh", title: "Automated warehouse normalization", body: "Cross-platform spend, impressions, clicks, orders, and ROAS are normalized and stored in isolated PostgreSQL tables.", detail: "On-demand + nightly sync · Currency & timezone aligned" },
                { id: "report", label: "3. Deliver", icon: "sheet", title: "Deliver to Looker Studio & Sheets", body: "Push clean, client-ready data directly into Google Sheets™ or live Looker Studio dashboard templates. Zero copy-paste.", detail: "Looker Studio community connector · Google Sheets™ add-on" },
                { id: "optimize", label: "4. Scale", icon: "zap", title: "Scale across dozens of brands", body: "Manage unlimited client brands with isolated workspaces and granular team roles (Owner, Admin, Member, Viewer).", detail: "Save 15+ hours/week across client accounts" },
            ],
        },
        cta: {
            h2: ["Stop manual reporting.", "Scale your agency."],
            sub: "Start a 14-day agency pilot with demo metrics or connect your first client source in 5 minutes. No credit card required.",
            btn: "Start 14-day agency pilot",
            trust: "No credit card required · Read-only OAuth · VND & USD billing",
            legal: "Google Sheets™ and Google Workspace™ are trademarks of Google LLC. Monstera Cloud is not affiliated with Google.",
        },
        stats: [
            { value: "< 60s", label: "First client sync" },
            { value: "6", label: "Certified sources" },
            { value: "0", label: "Spreadsheet cleanup" },
            { value: "100%", label: "Workspace isolated" },
        ],
        timeCompare: {
            heading: "Where does your agency's time go?",
            sub: "Every week, manual client reporting steals billable hours from growth and strategy.",
            steps: [
                { task: "Export CSVs across client ad accounts", time: "45 min" },
                { task: "Reconcile currency, ROAS & data drift", time: "85 min" },
                { task: "Format client decks & Google Sheets", time: "60 min" },
                { task: "Repeat for every client next week", time: "repeat" },
            ],
            total: "3h 10min",
            unit: "/client /week",
            after: {
                label: "With Monstera Cloud",
                total: "0 min",
                unit: "/week",
                setup: "5 min one-time workspace setup",
                tagline: "Automated client dashboards that update themselves every day.",
            },
        },
        proofRow1: [
            { quote: "Saved our agency 15+ hours every week across 12 client accounts.", author: "D.T., Agency Founder" },
            { quote: "Finally Shopee Ads, TikTok, and Meta in one normalized Looker Studio report.", author: "M.K., Performance Director" },
            { quote: "Client reporting went from 2 days of manual exports to zero.", author: "H.V., Media Lead" },
            { quote: "Our account managers stopped fighting over currency and attribution discrepancies.", author: "A.L., Head of Growth" },
        ],
        proofRow2: [
            { quote: "Our clients love having live Looker Studio decks that update automatically.", author: "K.R., Operations Director" },
            { quote: "Zero client data leaks between brand workspaces. Strict tenant isolation.", author: "T.P., Agency Technical Lead" },
            { quote: "Best ROI on any data infrastructure tool we have adopted.", author: "L.N., Managing Partner" },
            { quote: "Monday reporting standups are completely automated now.", author: "P.H., Performance Lead" },
        ],
        showcase: {
            eyebrow: "Connects to",
            from: "Client platforms",
            to: "Client dashboards",
        },
        screenshot: {
            eyebrow: "Multi-client console",
            heading: "One agency warehouse. Every client platform.",
            sub: "Real-time multi-channel sync, connection health monitoring, and automated metrics flowing into client dashboards.",
        },
        footer: {
            product: "Product",
            productLinks: [
                { label: "Sources", href: "/sources" },
                { label: "Exports", href: "/exports" },
                { label: "Pricing", href: "/pricing" },
            ],
            company: "Company",
            companyLinks: [
                { label: "About", href: "/about" },
                { label: "Support", href: "/support" },
                { label: "Changelog", href: "/changelog" },
            ],
            legal: "Legal",
            legalLinks: [
                { label: "Privacy Policy", href: "/legal/privacy-policy" },
                { label: "Terms of Service", href: "/legal/terms-of-service" },
                { label: "Refund Policy", href: "/legal/refund-policy" },
            ],
            copy: `© ${new Date().getFullYear()} Monstera Cloud. All rights reserved.`,
        },
    },
    vi: {
        hero: {
            h1: ["Biến dữ liệu quảng cáo & sàn", "thành báo cáo khách hàng tự động."],
            sub: "Monstera Cloud cung cấp cho agency một kho dữ liệu hợp nhất để kết nối, chuẩn hóa và tự động hóa báo cáo trên Meta, Google Ads, TikTok và Shopee — không còn dọn dẹp bảng tính thủ công.",
            cta: "Dùng thử 14 ngày cho Agency",
            ctaSub: "Khám phá mẫu dashboard",
            trust: [
                { icon: Shield, text: "Tách biệt Workspace đa khách hàng" },
                { icon: Lock, text: "Chỉ OAuth 2.0 đọc · Mã hóa AES-256" },
                { icon: Eye, text: "Đẩy thẳng Looker Studio & Google Sheets™" },
            ],
        },
        how: {
            eyebrow: "Quy trình dữ liệu agency",
            tabs: [
                { id: "connect", label: "1. Kết nối", icon: "plug", title: "Kết nối mọi tài khoản khách hàng", body: "Ủy quyền tài khoản Meta Ads, Google Ads, TikTok và Shopee của khách hàng trong 1 click qua OAuth chỉ đọc. Không cần chia sẻ mật khẩu.", detail: "Chọn lọc tài khoản khách hàng · Chỉ OAuth 2.0" },
                { id: "sync", label: "2. Chuẩn hóa", icon: "refresh", title: "Tự động chuẩn hóa dữ liệu kho", body: "Chi phí, hiển thị, nhấp chuột, đơn hàng và ROAS đa kênh được chuẩn hóa và lưu trữ an toàn trong PostgreSQL riêng biệt.", detail: "Đồng bộ thủ công & hàng đêm · Đồng nhất tiền tệ & múi giờ" },
                { id: "report", label: "3. Xuất báo cáo", icon: "sheet", title: "Đến thẳng Looker Studio & Sheets", body: "Dữ liệu sạch sẵn sàng đẩy vào Google Sheets™ hoặc các mẫu dashboard Looker Studio động cho khách hàng xem.", detail: "Kết nối Looker Studio · Add-on Google Sheets™" },
                { id: "optimize", label: "4. Mở rộng", icon: "zap", title: "Mở rộng quy mô hàng chục thương hiệu", body: "Quản lý nhiều thương hiệu khách hàng với Workspace riêng biệt và phân quyền thành viên chi tiết (Owner, Admin, Member, Viewer).", detail: "Tiết kiệm 15+ giờ/tuần trên toàn bộ khách hàng" },
            ],
        },
        cta: {
            h2: ["Dừng làm báo cáo thủ công.", "Mở rộng quy mô Agency."],
            sub: "Bắt đầu dùng thử 14 ngày với dữ liệu mẫu hoặc kết nối nguồn khách hàng đầu tiên trong 5 phút. Không cần thẻ tín dụng.",
            btn: "Bắt đầu dùng thử Agency",
            trust: "Không cần thẻ tín dụng · OAuth chỉ đọc · Thanh toán VND & USD",
            legal: "Google Sheets™ và Google Workspace™ là thương hiệu của Google LLC. Monstera Cloud không liên kết với Google.",
        },
        stats: [
            { value: "< 60s", label: "Đồng bộ đầu" },
            { value: "6", label: "Nguồn chứng nhận" },
            { value: "0", label: "Dọn dẹp bảng tính" },
            { value: "100%", label: "Tách biệt Workspace" },
        ],
        timeCompare: {
            heading: "Thời gian của agency đang đi đâu?",
            sub: "Mỗi tuần, việc làm báo cáo khách hàng thủ công lấy đi hàng giờ chiến lược của team.",
            steps: [
                { task: "Xuất CSV từ các tài khoản quảng cáo", time: "45 phút" },
                { task: "Quy đổi tỷ giá, ROAS & đối chiếu lệch số", time: "85 phút" },
                { task: "Định dạng slide báo cáo & Google Sheets", time: "60 phút" },
                { task: "Lặp lại cho từng khách hàng tuần sau", time: "lặp lại" },
            ],
            total: "3h 10min",
            unit: "/khách hàng /tuần",
            after: {
                label: "Với Monstera Cloud",
                total: "0 phút",
                unit: "/tuần",
                setup: "5 phút cài đặt Workspace một lần",
                tagline: "Dashboard khách hàng tự động cập nhật mỗi ngày.",
            },
        },
        proofRow1: [
            { quote: "Tiết kiệm hơn 15 giờ mỗi tuần trên 12 tài khoản khách hàng của agency chúng tôi.", author: "D.T., Chủ Agency" },
            { quote: "Cuối cùng Shopee Ads, TikTok và Meta nằm chung một báo cáo Looker Studio chuẩn.", author: "M.K., Performance Director" },
            { quote: "Báo cáo khách hàng từ mất 2 ngày xuất file nay hoàn toàn tự động.", author: "H.V., Media Lead" },
            { quote: "Account manager không còn cãi nhau vì lệch số tiền tệ và attribution.", author: "A.L., Head of Growth" },
        ],
        proofRow2: [
            { quote: "Khách hàng rất thích khi có link Looker Studio động tự cập nhật mỗi sáng.", author: "K.R., Operations Director" },
            { quote: "Không lo rò rỉ dữ liệu giữa các thương hiệu khách hàng. Phân quyền rất chặt chẽ.", author: "T.P., Agency Tech Lead" },
            { quote: "ROI tốt nhất trong các công cụ dữ liệu mà chúng tôi từng triển khai.", author: "L.N., Managing Partner" },
            { quote: "Cuộc họp báo cáo sáng thứ Hai diễn ra nhanh hơn và có số liệu ngay tức thì.", author: "P.H., Performance Lead" },
        ],
        showcase: {
            eyebrow: "Kết nối với",
            from: "Nền tảng khách hàng",
            to: "Dashboard khách hàng",
        },
        screenshot: {
            eyebrow: "Console đa khách hàng",
            heading: "Một kho dữ liệu agency. Mọi nền tảng khách hàng.",
            sub: "Theo dõi sức khỏe đồng bộ đa kênh theo thời gian thực và tự động đưa số liệu vào dashboard khách hàng.",
        },
        footer: {
            product: "Sản phẩm",
            productLinks: [
                { label: "Nguồn dữ liệu", href: "/sources" },
                { label: "Xuất Dữ Liệu", href: "/exports" },
                { label: "Bảng giá", href: "/pricing" },
            ],
            company: "Company",
            companyLinks: [
                { label: "Giới thiệu", href: "/about" },
                { label: "Hỗ trợ", href: "/support" },
                { label: "Nhật ký", href: "/changelog" },
            ],
            legal: "Pháp lý",
            legalLinks: [
                { label: "Chính sách bảo mật", href: "/legal/privacy-policy" },
                { label: "Điều khoản dịch vụ", href: "/legal/terms-of-service" },
                { label: "Chính sách hoàn tiền", href: "/legal/refund-policy" },
            ],
            copy: `© ${new Date().getFullYear()} Monstera Cloud. All rights reserved.`,
        },
    },
} as const;

type Lang = keyof typeof COPY;

const HERO_LOGOS = [
    { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
    { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
    { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
    { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
    { src: INTEGRATION_LOGOS.googleSheets, alt: "Google Sheets" },
    { src: INTEGRATION_LOGOS.looker, alt: "Looker Studio" },
];

// ─────────────────────────────────────────────
// Interactive Product Demo
// ─────────────────────────────────────────────
const DEMO_PLATFORMS = [
    { id: "tiktok_business", name: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok, metrics: "23 campaigns · $3,240 spend", syncedAgo: "12 min ago" },
    { id: "meta_ads", name: "Meta Ads", logo: INTEGRATION_LOGOS.meta, metrics: "12 ad sets · 4.2x ROAS", syncedAgo: "8 min ago" },
    { id: "shopee", name: "Shopee", logo: INTEGRATION_LOGOS.shopee, metrics: "156 orders · $8,910 revenue", syncedAgo: "5 min ago" },
    { id: "google_ads", name: "Google Ads", logo: INTEGRATION_LOGOS.googleAds, metrics: "8 campaigns · $0.91 CPC", syncedAgo: "3 min ago" },
] as const;

type ScreenshotCopy = (typeof COPY)[keyof typeof COPY]["screenshot"];

function InteractiveDemoSection({ copy }: { copy: ScreenshotCopy }) {
    const [selected, setSelected] = useState<Set<string>>(new Set(["tiktok_business", "meta_ads", "shopee", "google_ads"]));

    const toggle = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const activePlatforms = DEMO_PLATFORMS.filter(p => selected.has(p.id));
    const count = activePlatforms.length;

    return (
        <section className="border-t border-line px-6 py-24">
            <div className="mx-auto max-w-5xl text-center">
                <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">{copy.eyebrow}</p>
                <h2 className="mb-4 text-3xl font-semibold tracking-tight text-ink md:text-4xl">{copy.heading}</h2>
                <p className="mx-auto mb-10 max-w-xl text-sm leading-relaxed text-ink-mute">{copy.sub}</p>

                <div className="mb-10 flex flex-wrap items-center justify-center gap-2">
                    {DEMO_PLATFORMS.map(({ id, name, logo }) => {
                        const active = selected.has(id);
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => toggle(id)}
                                className={`governed-hover flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] ${
                                    active
                                        ? "border-white/20 bg-white/[0.06] text-ink"
                                        : "border-line bg-panel text-ink-mute"
                                }`}
                            >
                                <IntegrationMark src={logo} size="sm" className={active ? "" : "opacity-50"} />
                                {name}
                            </button>
                        );
                    })}
                </div>

                <div className="relative overflow-hidden rounded-lg border border-line bg-panel">
                    {/* Title bar */}
                    <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2.5">
                        <div className="h-2 w-2 rounded-full bg-white/15" />
                        <div className="h-2 w-2 rounded-full bg-white/15" />
                        <div className="h-2 w-2 rounded-full bg-white/15" />
                        <div className="ml-3 flex h-7 max-w-xs flex-1 items-center rounded-md border border-line bg-panel px-3">
                            <span className="font-mono text-[11px] text-ink-mute">monsteracloud.com/sources</span>
                        </div>
                    </div>

                    {/* Dashboard body */}
                    <div className="bg-canvas p-6 sm:p-8">
                        {/* Top bar */}
                        <div className="flex items-center justify-between mb-7">
                            <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-[11px] font-medium text-ink">
                                    M
                                </div>
                                <div>
                                    <div className="text-[13px] font-semibold text-gray-100 text-left tracking-tight">My Workspace</div>
                                    <div className="text-[11px] text-gray-500 text-left transition-all duration-300">
                                        {count === 0 ? "No sources connected" : `${count} source${count > 1 ? "s" : ""} connected`}
                                    </div>
                                </div>
                            </div>
                            {count > 0 && (
                                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-mute">
                                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                    All synced
                                </span>
                            )}
                        </div>

                        {/* Source cards grid */}
                        {count > 0 ? (
                            <div className={`grid gap-3.5 transition-all duration-300 ${count === 1 ? "grid-cols-1 max-w-sm mx-auto" : "grid-cols-1 sm:grid-cols-2"}`}>
                                {activePlatforms.map(({ id, logo, name, metrics, syncedAgo }) => (
                                    <div key={id} className="rounded-md border border-line bg-panel p-4 text-left">
                                        <div className="mb-4 flex items-start justify-between">
                                            <div className="flex items-center gap-3">
                                                <IntegrationMark src={logo} alt={name} size="sm" />
                                                <div>
                                                    <div className="text-[13px] font-semibold text-gray-100">{name}</div>
                                                    <div className="text-[11px] text-gray-500 mt-0.5">{metrics}</div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                                <span className="font-mono text-[11px] text-ink-mute">Synced {syncedAgo}</span>
                                            </div>
                                            <div className="h-1.5 w-20 rounded-full bg-white/[0.04] overflow-hidden">
                                                <div className="h-full rounded-full w-full bg-emerald-500/25" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="py-16 flex flex-col items-center justify-center gap-3">
                                <div className="w-12 h-12 rounded-2xl border border-dashed border-white/[0.08] flex items-center justify-center">
                                    <span className="text-gray-600 text-lg">+</span>
                                </div>
                                <p className="text-gray-600 text-sm">Select a platform above to connect</p>
                            </div>
                        )}

                        {/* Bottom bar */}
                        {count > 0 && (
                            <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/[0.05] transition-all duration-300">
                                <span className="text-[11px] text-gray-500 font-mono">Next auto-refresh in 47 min</span>
                                <span className="text-[11px] text-gray-500">Destination: <span className="text-gray-400 font-medium">Google Sheets™</span></span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

// ─────────────────────────────────────────────
// Tab icon map
// ─────────────────────────────────────────────
const TAB_ICONS: Record<string, React.ReactNode> = {
    plug: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="square" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    ),
    refresh: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="square" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
    ),
    sheet: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="square" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
        </svg>
    ),
    zap: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="square" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    ),
};

// ─────────────────────────────────────────────
// Feature Tabs
// ─────────────────────────────────────────────
type TabData = { id: string; label: string; icon: string; title: string; body: string; detail: string };

function FeatureTabs({ tabs, eyebrow }: { tabs: readonly TabData[]; eyebrow: string }) {
    const [active, setActive] = useState(0);
    const [tick, setTick] = useState(0);
    const tab = tabs[active];

    useEffect(() => {
        const id = setInterval(() => setActive(i => (i + 1) % tabs.length), 5000);
        return () => clearInterval(id);
    }, [tabs.length, tick]);

    const selectTab = (i: number) => {
        setActive(i);
        setTick(t => t + 1);
    };

    return (
        <section className="border-t border-line px-6 py-24">
            <div className="mx-auto max-w-4xl">
                <p className="mb-10 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">{eyebrow}</p>

                <div className="mb-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
                    {tabs.map((t, i) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => selectTab(i)}
                            className={`flex flex-col items-start gap-2 bg-canvas px-4 py-4 text-left transition-colors duration-150 ${
                                i === active ? "bg-panel text-ink" : "text-ink-mute hover:text-ink"
                            }`}
                        >
                            <span className="font-mono text-[10px] tracking-widest">0{i + 1}</span>
                            <span className="flex items-center gap-2 text-[13px] font-medium">
                                {TAB_ICONS[t.icon] || null}
                                {t.label}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="rounded-lg border border-line bg-panel p-8 sm:p-10">
                    <h3 className="mb-3 text-xl font-semibold tracking-tight text-ink">{tab.title}</h3>
                    <p className="mb-5 max-w-2xl text-sm leading-relaxed text-ink-mute">{tab.body}</p>
                    <p className="font-mono text-[11px] text-ink-mute">{tab.detail}</p>
                    <div className="mt-8 h-px bg-line">
                        <div
                            key={`${tab.id}-${tick}`}
                            className="h-px bg-accent/70"
                            style={{ animation: "progress 5s linear forwards" }}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const [on, setOn] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setOn(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.15 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return (
        <div ref={ref} className={`reveal-motion ${on ? "reveal-on" : "reveal-off"} ${className}`}>
            {children}
        </div>
    );
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────
export default function MarketingHomePage() {
    const [lang, setLang] = useState<Lang>("en");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        if (typeof window === "undefined") return;

        const applyLang = (value: string | null) => {
            if (value === "en" || value === "vi") setLang(value);
        };

        applyLang(window.localStorage.getItem(MARKETING_LANG_KEY));

        const onStorage = (e: StorageEvent) => {
            if (e.key === MARKETING_LANG_KEY) applyLang(e.newValue);
        };
        const onCustom = (e: Event) => applyLang((e as CustomEvent<Lang>).detail);

        window.addEventListener("storage", onStorage);
        window.addEventListener("marketing-lang-change", onCustom as EventListener);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("marketing-lang-change", onCustom as EventListener);
        };
    }, []);

    if (!mounted) return null;

    const c = COPY[lang];

    return (
        <div className="relative min-h-screen bg-canvas selection:bg-white/15">

            {/* ── 1. HERO ─────────────────────────────────────── */}
            <section className="mc-grid relative overflow-hidden pb-24 pt-20">
                <div className="mc-scan" aria-hidden />
                <div className="relative mx-auto max-w-3xl px-6 text-center">
                    <h1 className="mb-6 text-4xl font-semibold tracking-tight text-ink sm:text-5xl md:text-[3.5rem] md:leading-[1.12]">
                        {c.hero.h1[0]}<br />{c.hero.h1[1]}
                    </h1>
                    <p className="mb-3 text-lg text-ink-mute sm:text-xl">
                        {lang === "vi" ? "Hợp nhất dữ liệu " : "Unified performance across "}
                        <WordRotator words={lang === "vi" ? HERO_WORDS_VI : HERO_WORDS_EN} />
                        {lang === "vi" ? " cho toàn bộ khách hàng." : " for all your clients."}
                    </p>

                    <p className="mx-auto mb-10 max-w-xl text-[15px] leading-relaxed text-ink-mute">
                        {c.hero.sub}
                    </p>

                    <div className="mb-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                        <Link
                            href="/register"
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary-hover"
                        >
                            {c.hero.cta}
                            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </Link>
                        <Link
                            href="/showcase"
                            className="inline-flex items-center gap-2 rounded-md border border-line px-5 py-2.5 text-[13px] text-ink-mute transition-colors duration-150 hover:border-white/20 hover:text-ink"
                        >
                            {c.hero.ctaSub} <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </Link>
                    </div>

                    <div className="mb-10 flex items-center justify-center gap-6">
                        {HERO_LOGOS.map(({ src, alt }) => (
                            <IntegrationMark key={alt} src={src} alt={alt} size="sm" />
                        ))}
                    </div>

                    <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
                        {c.hero.trust.map(({ icon: Icon, text }) => (
                            <div key={text} className="flex items-center gap-2 text-[12px] text-ink-mute">
                                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                                <span>{text}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── STATS STRIP ───────────────────────────────── */}
            <section className="border-y border-line">
                <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-8 px-6 py-10 sm:gap-14">
                    {c.stats.map(({ value, label }, i) => (
                        <AnimatedStat key={label} value={value} label={label} delay={i * 120} />
                    ))}
                </div>
            </section>

            {/* ── TIME COMPARISON ──────────────────── */}
            <section className="border-b border-line px-6 py-24">
                <Reveal className="mx-auto max-w-5xl">
                    <h2 className="mb-4 text-center text-3xl font-semibold tracking-tight text-ink md:text-4xl">{c.timeCompare.heading}</h2>
                    <p className="mb-12 text-center text-sm text-ink-mute">{c.timeCompare.sub}</p>
                    <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
                        <div className="bg-canvas p-8">
                            <p className="mb-6 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Manual</p>
                            <ul className="space-y-3">
                                {c.timeCompare.steps.map(({ task, time }) => (
                                    <li key={task} className="flex items-start justify-between gap-4 border-b border-line pb-3 text-[13px]">
                                        <span className="text-ink-mute">{task}</span>
                                        <span className="shrink-0 font-mono text-ink">{time}</span>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-6 font-mono text-2xl text-ink">
                                {c.timeCompare.total} <span className="text-sm text-ink-mute">{c.timeCompare.unit}</span>
                            </p>
                        </div>
                        <div className="bg-panel p-8">
                            <p className="mb-6 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{c.timeCompare.after.label}</p>
                            <p className="font-mono text-6xl tracking-tight text-ink">{c.timeCompare.after.total}</p>
                            <p className="mt-2 text-sm text-ink-mute">{c.timeCompare.after.unit}</p>
                            <div className="my-6 h-px bg-line" />
                            <p className="text-[13px] text-ink">{c.timeCompare.after.setup}</p>
                            <p className="mt-2 text-[13px] text-ink-mute">{c.timeCompare.after.tagline}</p>
                        </div>
                    </div>
                </Reveal>
            </section>

            {/* ── SOCIAL PROOF TICKER ── */}
            <section className="overflow-hidden border-b border-line py-16">
                <div className="relative flex flex-col gap-8">
                    <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-32 bg-gradient-to-r from-canvas to-transparent" />
                    <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-32 bg-gradient-to-l from-canvas to-transparent" />

                    {/* Row 1 — scrolls left */}
                    <div className="flex animate-[ticker_35s_linear_infinite] hover:[animation-play-state:paused] w-max gap-20">
                        {[...c.proofRow1, ...c.proofRow1].map(({ quote, author }, i) => (
                            <p key={`r1-${i}`} className="flex-shrink-0 whitespace-nowrap text-[14px]">
                                <em className="text-ink-mute">&ldquo;{quote}&rdquo;</em>
                                <span className="ml-2 font-mono text-[12px] not-italic text-ink">— {author}</span>
                            </p>
                        ))}
                    </div>

                    {/* Row 2 — scrolls right */}
                    <div className="flex animate-[ticker-reverse_40s_linear_infinite] hover:[animation-play-state:paused] w-max gap-20">
                        {[...c.proofRow2, ...c.proofRow2].map(({ quote, author }, i) => (
                            <p key={`r2-${i}`} className="flex-shrink-0 whitespace-nowrap text-[14px]">
                                <em className="text-ink-mute">&ldquo;{quote}&rdquo;</em>
                                <span className="ml-2 font-mono text-[12px] not-italic text-ink">— {author}</span>
                            </p>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── INTERACTIVE PRODUCT DEMO ─────────────────────── */}
            <Reveal>
                <InteractiveDemoSection copy={c.screenshot} />
            </Reveal>

            {/* ── 2. HOW IT WORKS ─────────────────────────────── */}
            <FeatureTabs tabs={c.how.tabs} eyebrow={c.how.eyebrow} />

            {/* ── 3. TRUST + CTA ──────────────────────────────── */}
            <section className="border-t border-line px-6 py-24">
                <Reveal className="mx-auto max-w-4xl">
                    <div className="rounded-lg border border-line bg-panel px-8 py-16 text-center sm:py-20">
                        <h2 className="mb-4 text-3xl font-semibold tracking-tight text-ink md:text-4xl">
                            {c.cta.h2[0]}<br />{c.cta.h2[1]}
                        </h2>
                        <p className="mx-auto mb-8 max-w-md text-sm leading-relaxed text-ink-mute">{c.cta.sub}</p>
                        <Link
                            href="/register"
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary-hover"
                        >
                            {c.cta.btn}
                            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </Link>
                        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">{c.cta.trust}</p>
                        <p className="mx-auto mt-4 max-w-lg text-[11px] text-ink-mute">{c.cta.legal}</p>
                    </div>
                </Reveal>
            </section>

        </div>
    );
}
