"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Eye,
  Lock,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { trackEvent } from "@/lib/analytics-events";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { SignaturePipeline } from "./SignaturePipeline";
import { MarketingScrollReveal } from "./MarketingScrollReveal";

const MARKETING_LANG_KEY = "marketing_lang";
type Lang = "en" | "vi";

const COPY = {
  vi: {
    hero: {
      eyebrow: "Dành cho performance agency tại Việt Nam",
      title: ["Thêm khách hàng.", "Bớt giờ làm báo cáo."],
      description:
        "Đưa Meta Ads, Google Ads, TikTok Ads và Shopee vào workspace riêng cho từng khách hàng. Theo dõi chi tiêu, doanh thu do nền tảng ghi nhận, ROAS và tình trạng dữ liệu—sau đó đưa dữ liệu sạch sang Google Sheets hoặc Looker Studio.",
      primary: "Dùng thử Agency Pro 7 ngày",
      secondary: "Xem dashboard mẫu",
      note: "Không cần thẻ · Có hướng dẫn thiết lập · Dữ liệu tách biệt theo workspace",
    },
    preview: {
      kicker: "DASHBOARD MẪU",
      client: "Khách hàng mẫu · TP.HCM",
      range: "30 ngày gần nhất",
      spend: "Chi tiêu",
      revenue: "Doanh thu nền tảng",
      roas: "ROAS",
      pacing: "Tiến độ ngân sách",
      sources: "Tình trạng nguồn dữ liệu",
      healthy: "Ổn định",
      action: "Cần kết nối lại",
      disclaimer: "Số liệu minh hoạ giao diện sản phẩm, không phải kết quả khách hàng.",
    },
    trust: [
      { icon: Eye, label: "Quyền truy cập báo cáo, không chỉnh chiến dịch" },
      { icon: Lock, label: "Thông tin xác thực được mã hoá khi lưu" },
      { icon: ShieldCheck, label: "Dữ liệu tách biệt theo workspace" },
      { icon: RefreshCcw, label: "Đồng bộ theo yêu cầu hoặc theo lịch" },
    ],
    providerLabel: "Một luồng báo cáo cho các nền tảng bạn đang dùng",
    outcomes: {
      eyebrow: "Vận hành như một agency lớn hơn",
      title: "Không thêm người chỉ để ghép số liệu.",
      description:
        "Monstera biến công việc báo cáo lặp lại thành một hệ thống mà founder, media buyer và khách hàng đều có thể hiểu.",
      items: [
        {
          icon: Clock3,
          title: "Bớt xuất file thủ công",
          description: "Kéo dữ liệu từ nhiều kênh về một cấu trúc chung thay vì ghép CSV trước mỗi buổi review.",
          points: ["Theo dõi độ mới của dữ liệu", "Xem lỗi nguồn ở một nơi", "Xuất sang Sheets, Looker hoặc API"],
        },
        {
          icon: Users,
          title: "Mỗi khách hàng, một workspace",
          description: "Giữ tài khoản, dữ liệu và thành viên của từng khách hàng tách biệt khi agency mở rộng.",
          points: ["Phạm vi dữ liệu rõ ràng", "Chuyển workspace nhanh", "Hỗ trợ quy trình nhiều khách hàng"],
        },
        {
          icon: TrendingUp,
          title: "Nhìn thấy điều cần hành động",
          description: "Theo dõi chi tiêu, doanh thu do nền tảng ghi nhận, ROAS và các kết nối cần chú ý.",
          points: ["KPI đa nền tảng", "Tiến độ ngân sách", "Cảnh báo kết nối và đồng bộ"],
        },
      ],
    },
    workflow: {
      eyebrow: "Từ nền tảng đến báo cáo",
      title: "Một đường đi rõ ràng cho dữ liệu khách hàng.",
      description:
        "Kết nối tài khoản, chuẩn hoá số liệu, lưu lịch sử rồi chuyển dữ liệu đến nơi team đang làm việc.",
    },
    pilot: {
      eyebrow: "7 ngày để kiểm chứng giá trị",
      title: "Bắt đầu bằng một khách hàng thật.",
      description:
        "Pilot được thiết kế để agency đi từ kết nối đầu tiên đến một báo cáo có thể sử dụng—không phải một tài khoản trống để tự khám phá.",
      steps: [
        ["Ngày 1", "Chọn một khách hàng và kết nối các nguồn dữ liệu phù hợp."],
        ["Ngày 2–3", "Kiểm tra dữ liệu, KPI, độ mới và luồng đưa sang công cụ báo cáo."],
        ["Ngày 4–7", "Dùng trong một phiên review thật và quyết định có tiếp tục hay không."],
      ],
      price: "Sau pilot: 1.490.000 ₫/tháng",
      note: "Nếu không tiếp tục, workspace giữ nguyên và chuyển về giới hạn gói Free.",
      button: "Bắt đầu pilot 7 ngày",
    },
    security: {
      eyebrow: "Ranh giới rõ ràng",
      title: "Bảo vệ dữ liệu mà không hứa quá mức.",
      items: [
        ["Ủy quyền qua nền tảng", "Khi nền tảng hỗ trợ OAuth, bạn cấp quyền thay vì chia sẻ mật khẩu."],
        ["Chỉ đọc dữ liệu báo cáo", "Các kết nối quảng cáo lấy số liệu; chúng không thay đổi chiến dịch."],
        ["Phân tách theo workspace", "Truy vấn và dữ liệu ứng dụng được giới hạn trong workspace đã chọn."],
        ["Bạn giữ quyền kiểm soát", "Có thể xem, ngắt và kết nối lại nguồn dữ liệu trong sản phẩm."],
      ],
    },
    faq: {
      eyebrow: "Trước khi bắt đầu",
      title: "Những câu hỏi agency thường hỏi.",
      items: [
        ["Monstera có chỉnh sửa chiến dịch không?", "Không. Các tích hợp quảng cáo được thiết kế để lấy dữ liệu phục vụ báo cáo, không thay đổi campaign, budget hay creative."],
        ["Khách hàng có nhìn thấy dữ liệu của nhau không?", "Không theo luồng sản phẩm dự kiến. Mỗi khách hàng được vận hành trong workspace riêng, với dữ liệu và thành viên theo workspace."],
        ["Pilot 7 ngày gồm những gì?", "Bạn dùng Agency Pro với một workspace thực tế, kết nối nguồn, kiểm tra dữ liệu và thử một quy trình báo cáo thực."],
        ["Hết pilot thì sao?", "Bạn có thể tiếp tục với Agency Pro 1.490.000 ₫/tháng. Nếu không, workspace được giữ lại dưới giới hạn gói Free."],
      ],
    },
    cta: {
      title: "Khách hàng tiếp theo không nên làm báo cáo khó hơn.",
      description: "Dùng một khách hàng thật để xem Monstera có giảm thời gian vận hành báo cáo của agency hay không.",
      primary: "Dùng thử Agency Pro 7 ngày",
      secondary: "Xem giá",
    },
  },
  en: {
    hero: {
      eyebrow: "Built for performance agencies in Vietnam",
      title: ["More clients.", "Fewer hours spent reporting."],
      description:
        "Bring Meta Ads, Google Ads, TikTok Ads, and Shopee into a separate workspace for every client. Monitor spend, provider-reported revenue, ROAS, and data health—then deliver clean data to Google Sheets or Looker Studio.",
      primary: "Try Agency Pro for 7 days",
      secondary: "See the sample dashboard",
      note: "No card required · Guided setup · Workspace-scoped data",
    },
    preview: {
      kicker: "SAMPLE DASHBOARD",
      client: "Sample client · Ho Chi Minh City",
      range: "Last 30 days",
      spend: "Spend",
      revenue: "Provider revenue",
      roas: "ROAS",
      pacing: "Budget pacing",
      sources: "Source health",
      healthy: "Healthy",
      action: "Reconnect",
      disclaimer: "Illustrative product data—not a customer result.",
    },
    trust: [
      { icon: Eye, label: "Reporting access without campaign edits" },
      { icon: Lock, label: "Credentials encrypted at rest" },
      { icon: ShieldCheck, label: "Workspace-scoped data" },
      { icon: RefreshCcw, label: "On-demand or scheduled syncs" },
    ],
    providerLabel: "One reporting flow for the platforms you already use",
    outcomes: {
      eyebrow: "Operate like a larger agency",
      title: "Grow without hiring people just to assemble reports.",
      description:
        "Monstera turns recurring reporting work into a system founders, media buyers, and clients can understand.",
      items: [
        {
          icon: Clock3,
          title: "Fewer manual exports",
          description: "Bring channel data into one structure instead of stitching CSV files together before every review.",
          points: ["Inspect data freshness", "See source issues in one place", "Deliver to Sheets, Looker, or API"],
        },
        {
          icon: Users,
          title: "One workspace per client",
          description: "Keep each client’s accounts, data, and members distinct as the agency grows.",
          points: ["Clear data boundaries", "Quick workspace switching", "Multi-client operations"],
        },
        {
          icon: TrendingUp,
          title: "See what needs action",
          description: "Monitor spend, provider-reported revenue, ROAS, and connections that need attention.",
          points: ["Cross-channel KPIs", "Budget pacing", "Connection and sync signals"],
        },
      ],
    },
    workflow: {
      eyebrow: "From platform to report",
      title: "A clear path for every client’s data.",
      description: "Connect accounts, normalize metrics, retain history, and deliver data where the team already works.",
    },
    pilot: {
      eyebrow: "Seven days to prove value",
      title: "Start with one real client.",
      description:
        "The pilot is designed to move an agency from its first connection to a usable reporting workflow—not leave you with an empty account to explore alone.",
      steps: [
        ["Day 1", "Choose one client and connect the relevant data sources."],
        ["Days 2–3", "Validate the data, KPIs, freshness, and delivery workflow."],
        ["Days 4–7", "Use it in a real review and decide whether it earns a place in your stack."],
      ],
      price: "After the pilot: 1,490,000 VND/month",
      note: "If you do not continue, the workspace remains and moves to Free-plan limits.",
      button: "Start the 7-day pilot",
    },
    security: {
      eyebrow: "Clear boundaries",
      title: "Protect client data without overpromising.",
      items: [
        ["Provider authorization", "Where OAuth is available, you authorize access instead of sharing passwords."],
        ["Reporting data only", "Advertising connections retrieve reporting data; they do not alter campaigns."],
        ["Workspace separation", "Application queries and data are constrained to the selected workspace."],
        ["You stay in control", "Review, disconnect, and re-authorize sources from the product."],
      ],
    },
    faq: {
      eyebrow: "Before you start",
      title: "Questions agencies usually ask.",
      items: [
        ["Does Monstera edit campaigns?", "No. Advertising integrations are built to retrieve reporting data, not change campaigns, budgets, or creative."],
        ["Can clients see one another’s data?", "Not in the intended product flow. Each client operates in a separate workspace with workspace-scoped data and membership."],
        ["What is included in the 7-day pilot?", "Use Agency Pro with one real workspace, connect sources, validate the data, and test a real reporting workflow."],
        ["What happens after the pilot?", "Continue with Agency Pro at 1,490,000 VND/month, or keep the workspace under Free-plan limits."],
      ],
    },
    cta: {
      title: "Your next client should not make reporting harder.",
      description: "Use one real client to see whether Monstera reduces your agency’s reporting overhead.",
      primary: "Try Agency Pro for 7 days",
      secondary: "See pricing",
    },
  },
} as const;

const PROVIDERS = [
  { name: "Meta Ads", logo: INTEGRATION_LOGOS.meta, href: "/integrations/meta-ads-to-google-sheets" },
  { name: "Google Ads", logo: INTEGRATION_LOGOS.googleAds, href: "/integrations/google-ads-to-google-sheets" },
  { name: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok, href: "/integrations/tiktok-ads-to-google-sheets" },
  { name: "Shopee", logo: INTEGRATION_LOGOS.shopee, href: "/integrations/shopee-to-google-sheets" },
];

function PilotLink({ children, location, className }: { children: ReactNode; location: string; className: string }) {
  return (
    <Link
      href="/register"
      className={className}
      onClick={() => trackEvent("landing_pilot_cta_clicked", { location, offer: "agency_pro_7_day" })}
    >
      {children}
    </Link>
  );
}

function AgencyControlRoomPreview({ lang }: { lang: Lang }) {
  const t = COPY[lang].preview;
  const sources = [
    { name: "Meta Ads", logo: INTEGRATION_LOGOS.meta, status: t.healthy, tone: "text-emerald-400" },
    { name: "Google Ads", logo: INTEGRATION_LOGOS.googleAds, status: t.healthy, tone: "text-emerald-400" },
    { name: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok, status: t.healthy, tone: "text-emerald-400" },
    { name: "Shopee", logo: INTEGRATION_LOGOS.shopee, status: t.action, tone: "text-amber-400" },
  ];

  return (
    <div id="sample-dashboard" className="relative mx-auto w-full max-w-[720px] scroll-mt-24">
      <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-emerald-400/[0.07] blur-3xl" />
      <div className="overflow-hidden rounded-2xl border border-white/[0.13] bg-[#0d1010] shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-300/15 bg-emerald-400/10 text-emerald-300"><BarChart3 className="h-4 w-4" /></span>
            <div><p className="font-mono text-[9px] font-semibold tracking-[0.18em] text-emerald-300">{t.kicker}</p><p className="mt-0.5 text-xs font-medium text-ink sm:text-sm">{t.client}</p></div>
          </div>
          <span className="rounded-md border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[10px] text-ink-mute">{t.range}</span>
        </div>

        <div className="grid gap-px bg-white/[0.07] sm:grid-cols-3">
          {[
            [t.spend, "126,4M ₫", "+8,2%"],
            [t.revenue, "482,6M ₫", "+12,6%"],
            [t.roas, "3,82x", "+0,16"],
          ].map(([label, value, change]) => (
            <div key={label} className="bg-[#0d1010] px-5 py-5">
              <p className="text-[10px] uppercase tracking-[0.13em] text-ink-mute">{label}</p>
              <div className="mt-3 flex items-end justify-between gap-3"><strong className="text-2xl font-semibold tracking-tight text-ink">{value}</strong><span className="pb-0.5 font-mono text-[10px] text-emerald-400">{change}</span></div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-[1.05fr_0.95fr] sm:p-5">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <div className="flex items-center justify-between"><p className="text-xs font-medium text-ink">{t.pacing}</p><span className="font-mono text-[11px] text-emerald-300">75%</span></div>
            <div className="relative mt-6 h-28 overflow-hidden rounded-lg border border-white/[0.06] bg-black/20 px-3 pt-3">
              <div className="absolute inset-x-3 bottom-3 top-3 flex items-end gap-2">
                {[32, 46, 41, 62, 58, 73, 68, 82, 76, 88, 80, 94].map((height, index) => <span key={index} className="flex-1 rounded-t-sm bg-gradient-to-t from-emerald-500/35 to-emerald-300/80" style={{ height: `${height}%` }} />)}
              </div>
              <div className="absolute inset-x-3 top-[35%] border-t border-dashed border-amber-300/35" />
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-ink-mute"><span>95,1M ₫</span><span>126,8M ₫ budget</span></div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-ink">{t.sources}</p><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]" /></div>
            <div className="divide-y divide-white/[0.06]">
              {sources.map((source) => <div key={source.name} className="flex items-center justify-between py-2.5"><div className="flex items-center gap-2.5"><IntegrationMark src={source.logo} alt="" size="sm" /><span className="text-[11px] font-medium text-ink">{source.name}</span></div><span className={`font-mono text-[9px] ${source.tone}`}>● {source.status}</span></div>)}
            </div>
          </div>
        </div>
        <p className="border-t border-white/[0.07] px-5 py-2.5 text-[9px] leading-relaxed text-ink-mute">{t.disclaimer}</p>
      </div>
    </div>
  );
}

export default function MarketingHomePage() {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(MARKETING_LANG_KEY);
    if (saved === "en" || saved === "vi") setLang(saved);
    const onLangChange = (event: Event) => setLang((event as CustomEvent<Lang>).detail);
    window.addEventListener("marketing-lang-change", onLangChange);
    return () => window.removeEventListener("marketing-lang-change", onLangChange);
  }, []);

  const t = COPY[lang];

  return (
    <div lang={lang} className="overflow-x-clip pb-16">
      <section className="relative isolate px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[42rem] bg-[radial-gradient(ellipse_at_top,rgba(52,211,153,0.09),transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
          <MarketingScrollReveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-400/[0.07] px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{t.hero.eyebrow}</div>
            <h1 className="mt-7 text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-ink sm:text-6xl lg:text-[4.45rem]"><span className="block">{t.hero.title[0]}</span><span className="mt-2 block text-neutral-400">{t.hero.title[1]}</span></h1>
            <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-ink-mute sm:text-lg">{t.hero.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PilotLink location="hero" className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-white/50">{t.hero.primary}<ArrowRight className="ml-2 h-4 w-4" /></PilotLink>
              <Link href="#sample-dashboard" onClick={() => trackEvent("landing_sample_dashboard_clicked", { language: lang })} className="inline-flex items-center justify-center rounded-md border border-line bg-panel px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.04]">{t.hero.secondary}</Link>
            </div>
            <p className="mt-4 font-mono text-[10px] leading-relaxed text-ink-mute">{t.hero.note}</p>
          </MarketingScrollReveal>
          <MarketingScrollReveal delay={100}><AgencyControlRoomPreview lang={lang} /></MarketingScrollReveal>
        </div>
      </section>

      <section aria-label="Trust signals" className="border-y border-line bg-panel/35 px-4 py-5 sm:px-6 lg:px-8"><MarketingScrollReveal className="mx-auto grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-4">{t.trust.map(({ icon: Icon, label }) => <div key={label} className="flex items-center gap-2.5 px-2 text-xs leading-snug text-ink-mute"><Icon className="h-4 w-4 shrink-0 text-ink" strokeWidth={1.5} /><span>{label}</span></div>)}</MarketingScrollReveal></section>

      <section id="integrations" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20 lg:px-8"><MarketingScrollReveal className="mx-auto max-w-6xl"><p className="mb-6 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">{t.providerLabel}</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{PROVIDERS.map((provider) => <Link key={provider.name} href={provider.href} className="flex h-16 items-center justify-center gap-3 rounded-lg border border-line bg-panel px-4 transition-colors hover:border-white/25 hover:bg-white/[0.03]"><IntegrationMark src={provider.logo} alt="" size="sm" /><span className="text-sm font-medium text-ink">{provider.name}</span></Link>)}</div><div className="mt-3 grid grid-cols-3 gap-3 text-center text-[11px] text-ink-mute"><span className="rounded-md border border-line bg-panel/40 px-3 py-2">Google Sheets</span><span className="rounded-md border border-line bg-panel/40 px-3 py-2">Looker Studio</span><span className="rounded-md border border-line bg-panel/40 px-3 py-2">CSV &amp; API</span></div></MarketingScrollReveal></section>

      <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8"><div className="mx-auto max-w-6xl"><MarketingScrollReveal className="max-w-2xl"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">{t.outcomes.eyebrow}</p><h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{t.outcomes.title}</h2><p className="mt-5 text-base leading-relaxed text-ink-mute">{t.outcomes.description}</p></MarketingScrollReveal><div className="mt-12 grid gap-4 md:grid-cols-3">{t.outcomes.items.map((item, index) => { const Icon = item.icon; return <MarketingScrollReveal key={item.title} delay={index * 70} className="h-full"><article className="flex h-full flex-col rounded-xl border border-line bg-panel p-6 transition-colors hover:border-white/20"><div className="mb-8 flex items-center justify-between"><span className="font-mono text-xs text-ink-mute">0{index + 1}</span><span className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-300/15 bg-emerald-400/[0.07]"><Icon className="h-4 w-4 text-emerald-300" /></span></div><h3 className="text-lg font-semibold text-ink">{item.title}</h3><p className="mt-3 text-sm leading-relaxed text-ink-mute">{item.description}</p><ul className="mt-6 space-y-2 border-t border-line pt-5 text-xs leading-relaxed text-ink-mute">{item.points.map((point) => <li key={point} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />{point}</li>)}</ul></article></MarketingScrollReveal>; })}</div></div></section>

      <section id="architecture" className="scroll-mt-20 border-y border-line bg-panel/30 px-4 py-20 sm:px-6 sm:py-28 lg:px-8"><div className="mx-auto max-w-6xl"><MarketingScrollReveal className="mb-10 grid gap-4 md:grid-cols-[1fr_auto] md:items-end"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">{t.workflow.eyebrow}</p><h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{t.workflow.title}</h2></div><p className="max-w-md text-sm leading-relaxed text-ink-mute">{t.workflow.description}</p></MarketingScrollReveal><MarketingScrollReveal><SignaturePipeline /></MarketingScrollReveal></div></section>

      <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-6xl overflow-hidden rounded-2xl border border-white/[0.1] bg-panel lg:grid-cols-[0.82fr_1.18fr]"><MarketingScrollReveal className="flex h-full flex-col justify-between bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.12),transparent_58%)] p-7 sm:p-10"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">{t.pilot.eyebrow}</p><h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.pilot.title}</h2><p className="mt-5 text-sm leading-relaxed text-ink-mute">{t.pilot.description}</p></div><div className="mt-10"><p className="text-base font-semibold text-ink">{t.pilot.price}</p><p className="mt-2 text-xs leading-relaxed text-ink-mute">{t.pilot.note}</p></div></MarketingScrollReveal><div className="border-t border-line p-7 sm:p-10 lg:border-l lg:border-t-0"><div className="space-y-7">{t.pilot.steps.map(([day, description], index) => <MarketingScrollReveal key={day} delay={index * 70} className="relative"><div className="grid grid-cols-[auto_1fr] gap-4"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-400/[0.08] font-mono text-[10px] text-emerald-300">0{index + 1}</span><div><h3 className="text-sm font-semibold text-ink">{day}</h3><p className="mt-1 text-sm leading-relaxed text-ink-mute">{description}</p></div></div></MarketingScrollReveal>)}</div><PilotLink location="pilot" className="mt-9 inline-flex w-full items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200">{t.pilot.button}<ArrowRight className="ml-2 h-4 w-4" /></PilotLink></div></div></section>

      <section id="security" className="scroll-mt-20 border-y border-line bg-panel/30 px-4 py-20 sm:px-6 sm:py-28 lg:px-8"><div className="mx-auto max-w-6xl"><MarketingScrollReveal className="max-w-2xl"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">{t.security.eyebrow}</p><h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{t.security.title}</h2></MarketingScrollReveal><div className="mt-10 grid gap-4 sm:grid-cols-2">{t.security.items.map(([title, description], index) => <MarketingScrollReveal key={title} delay={index * 60}><article className="rounded-lg border border-line bg-canvas p-6"><span className="font-mono text-[11px] text-emerald-400">0{index + 1}</span><h3 className="mt-5 text-base font-semibold text-ink">{title}</h3><p className="mt-2 text-sm leading-relaxed text-ink-mute">{description}</p></article></MarketingScrollReveal>)}</div></div></section>

      <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8"><div className="mx-auto max-w-4xl"><MarketingScrollReveal className="text-center"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">{t.faq.eyebrow}</p><h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{t.faq.title}</h2></MarketingScrollReveal><div className="mt-10 divide-y divide-line border-y border-line">{t.faq.items.map(([question, answer], index) => <MarketingScrollReveal key={question} delay={index * 50}><details className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-ink"><span>{question}</span><span className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-ink-mute transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 max-w-3xl pr-10 text-sm leading-relaxed text-ink-mute">{answer}</p></details></MarketingScrollReveal>)}</div></div></section>

      <section className="px-4 pb-16 pt-4 sm:px-6 sm:pb-24 lg:px-8"><MarketingScrollReveal className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-emerald-300/15 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.13),transparent_66%)] px-6 py-14 text-center sm:px-12 sm:py-20"><div aria-hidden className="absolute inset-0 -z-10 bg-panel" /><Sparkles className="mx-auto h-5 w-5 text-emerald-300" /><h2 className="mx-auto mt-5 max-w-3xl text-balance text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{t.cta.title}</h2><p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-mute">{t.cta.description}</p><div className="mt-8 flex flex-wrap justify-center gap-3"><PilotLink location="final" className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200">{t.cta.primary}<ArrowRight className="ml-2 h-4 w-4" /></PilotLink><Link href="/pricing" className="inline-flex items-center justify-center rounded-md border border-line bg-canvas px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.04]">{t.cta.secondary}</Link></div></MarketingScrollReveal></section>
    </div>
  );
}
