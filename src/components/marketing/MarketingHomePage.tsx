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
  TrendingUp,
  Users,
} from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { trackEvent } from "@/lib/analytics-events";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { MarketingScrollReveal } from "./MarketingScrollReveal";

import { MarketingProductTour } from "./MarketingProductTour";
import "./marketing-home.css";

const MARKETING_LANG_KEY = "marketing_lang";
type Lang = "en" | "vi";

const COPY = {
  vi: {
    hero: {
      eyebrow: "Dành cho performance agency tại Việt Nam",
      title: ["Thêm khách hàng.", "Bớt giờ làm báo cáo."],
      description:
        "Gom báo cáo Meta Ads, Google Ads, TikTok Ads và Shopee theo từng khách hàng. Theo dõi KPI, tình trạng dữ liệu và đưa báo cáo sang Sheets hoặc Looker Studio.",
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
      trend: "Xu hướng doanh thu",
      sources: "Tình trạng nguồn dữ liệu",
      healthy: "Ổn định",
      action: "Cần kết nối lại",
      disclaimer: "Số liệu minh hoạ giao diện sản phẩm, không phải kết quả khách hàng.",
      tabs: { overview: "Tổng quan", sources: "Nguồn dữ liệu", delivery: "Bàn giao" },
      sourceTitle: "Tình trạng kết nối",
      sourceNote: "Đồng bộ báo cáo theo yêu cầu hoặc theo lịch.",
      deliveryTitle: "Sẵn sàng cho báo cáo khách hàng",
      deliveryNote: "Dùng cùng bộ dữ liệu trong công cụ team đang sử dụng.",
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
        "Bring Meta Ads, Google Ads, TikTok Ads, and Shopee into one reporting flow for every client. Track performance and data health, then deliver reports to Sheets or Looker Studio.",
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
      trend: "Revenue trend",
      sources: "Source health",
      healthy: "Healthy",
      action: "Reconnect",
      disclaimer: "Illustrative product data—not a customer result.",
      tabs: { overview: "Overview", sources: "Sources", delivery: "Delivery" },
      sourceTitle: "Connection health",
      sourceNote: "Refresh reporting data on demand or on a schedule.",
      deliveryTitle: "Ready for client reporting",
      deliveryNote: "Use the same prepared data in the tools your team already works in.",
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
      href="/register?offer=agency-pro-pilot"
      className={className}
      onClick={() => trackEvent("landing_pilot_cta_clicked", { location, offer: "agency_pro_7_day" })}
    >
      {children}
    </Link>
  );
}

function AgencyControlRoomPreview({ lang }: { lang: Lang }) {
  const t = COPY[lang].preview;
  const [view, setView] = useState<"overview" | "sources" | "delivery">("overview");
  const sources = [
    { name: "Meta Ads", logo: INTEGRATION_LOGOS.meta, status: t.healthy, tone: "text-emerald-400" },
    { name: "Google Ads", logo: INTEGRATION_LOGOS.googleAds, status: t.healthy, tone: "text-emerald-400" },
    { name: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok, status: t.healthy, tone: "text-emerald-400" },
    { name: "Shopee", logo: INTEGRATION_LOGOS.shopee, status: t.action, tone: "text-amber-400" },
  ];

  return (
    <div id="sample-dashboard" className="relative mx-auto w-full max-w-[1180px] scroll-mt-24">
      <div aria-hidden className="absolute -inset-8 -z-10 rounded-full bg-white/[0.025] blur-3xl" />
      <div className="overflow-hidden rounded-2xl border border-white/[0.12] bg-[#111111] shadow-[0_32px_100px_rgba(0,0,0,0.48)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.05] text-white"><BarChart3 className="h-4 w-4" /></span>
            <div><p className="font-mono text-[9px] font-semibold tracking-[0.18em] text-ink-mute">{t.kicker}</p><p className="mt-0.5 text-xs font-medium text-ink sm:text-sm">{t.client}</p></div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-black/30 p-1" role="group" aria-label={lang === "vi" ? "Chế độ xem báo cáo mẫu" : "Sample report views"}>
            {(["overview", "sources", "delivery"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={view === item} onClick={() => { setView(item); trackEvent("landing_sample_view_selected", { view: item, language: lang }); }} className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${view === item ? "bg-white text-black" : "text-ink-mute hover:text-ink"}`}>
                {t.tabs[item]}
              </button>
            ))}
          </div>
        </div>

        <div key={view} className="preview-panel" aria-live="polite">
          {view === "overview" ? <>
            <div className="grid grid-cols-3 gap-px bg-white/[0.08]">
              {[[t.spend, "126,4M ₫", "+8,2%"], [t.revenue, "482,6M ₫", "+12,6%"], [t.roas, "3,82x", "+0,16"]].map(([label, value, change]) => (
                <div key={label} className="bg-[#111111] px-3 py-4 sm:px-6 sm:py-5">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-ink-mute sm:text-[10px] sm:tracking-[0.13em]">{label}</p>
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1"><strong className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-ink sm:text-2xl">{value}</strong><span className="font-mono text-[9px] text-emerald-400 sm:text-[10px]">{change}</span></div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-[1.6fr_0.9fr] sm:p-6">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 sm:p-5">
                <div className="flex items-center justify-between"><p className="text-xs font-medium text-ink">{t.trend}</p><span className="font-mono text-[10px] text-ink-mute">{t.range}</span></div>
                <div className="relative mt-4 h-32 overflow-hidden rounded-lg border border-white/[0.06] bg-black/20 px-3 pt-3 sm:h-52">
                  <div className="absolute inset-3 flex flex-col justify-between" aria-hidden="true"><span className="border-t border-dashed border-white/[0.08]" /><span className="border-t border-dashed border-white/[0.08]" /><span className="border-t border-dashed border-white/[0.08]" /><span className="border-t border-white/[0.08]" /></div>
                  <svg className="absolute inset-x-3 bottom-3 top-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] overflow-visible" viewBox="0 0 720 180" preserveAspectRatio="none" role="img" aria-label={lang === "vi" ? "Biểu đồ doanh thu minh hoạ" : "Illustrative provider-reported revenue trend"}>
                    <defs><linearGradient id="landing-revenue-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8ce5bc" stopOpacity=".25" /><stop offset="100%" stopColor="#8ce5bc" stopOpacity="0" /></linearGradient></defs>
                    <path d="M0 145 C34 138 43 116 74 124 S113 137 145 112 S184 123 216 101 S254 117 288 90 S327 104 360 78 S399 90 432 65 S471 87 504 58 S543 70 576 45 S615 69 648 36 S690 47 720 19 V180 H0Z" fill="url(#landing-revenue-fill)" />
                    <path className="landing-chart-line" d="M0 145 C34 138 43 116 74 124 S113 137 145 112 S184 123 216 101 S254 117 288 90 S327 104 360 78 S399 90 432 65 S471 87 504 58 S543 70 576 45 S615 69 648 36 S690 47 720 19" fill="none" stroke="#9de8c5" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
                    <circle cx="720" cy="19" r="4.5" fill="#b4f2d3" />
                  </svg>
                </div>
                <div className="mt-2 flex justify-between px-1 font-mono text-[9px] text-ink-mute"><span>01</span><span>10</span><span>20</span><span>30</span></div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 sm:p-5">
                <div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-ink">{t.sources}</p><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /></div>
                <div className="divide-y divide-white/[0.06]">{sources.map((source) => <div key={source.name} className="flex items-center justify-between py-2.5"><div className="flex items-center gap-2.5"><IntegrationMark src={source.logo} alt="" size="sm" /><span className="text-[11px] font-medium text-ink">{source.name}</span></div><span className={`font-mono text-[9px] ${source.tone}`}>● {source.status}</span></div>)}</div>
              </div>
            </div>
          </> : view === "sources" ? <div className="grid gap-8 p-5 sm:grid-cols-[0.8fr_1.2fr] sm:p-10">
            <div className="self-center"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">01 / {t.tabs.sources}</p><h3 className="mt-3 text-xl font-medium tracking-tight text-ink sm:text-2xl">{t.sourceTitle}</h3><p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-mute">{t.sourceNote}</p></div>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 px-4 sm:px-6">{sources.map((source) => <div key={source.name} className="flex items-center justify-between border-b border-white/[0.07] py-4 last:border-b-0"><div className="flex items-center gap-3"><IntegrationMark src={source.logo} alt="" size="sm" /><span className="text-sm font-medium text-ink">{source.name}</span></div><span className={`font-mono text-[10px] ${source.tone}`}>● {source.status}</span></div>)}</div>
          </div> : <div className="grid gap-8 p-5 sm:grid-cols-[0.8fr_1.2fr] sm:p-10">
            <div className="self-center"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">03 / {t.tabs.delivery}</p><h3 className="mt-3 text-xl font-medium tracking-tight text-ink sm:text-2xl">{t.deliveryTitle}</h3><p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-mute">{t.deliveryNote}</p></div>
            <div className="grid gap-3 sm:grid-cols-2">{[{ name: "Google Sheets", logo: INTEGRATION_LOGOS.googleSheets, detail: lang === "vi" ? "Luồng bảng tính" : "Spreadsheet workflow" }, { name: "Looker Studio", logo: INTEGRATION_LOGOS.looker, detail: lang === "vi" ? "Luồng báo cáo" : "Reporting workflow" }].map((destination) => <div key={destination.name} className="flex min-h-36 flex-col justify-between rounded-xl border border-white/[0.08] bg-black/20 p-5"><IntegrationMark src={destination.logo} alt="" size="md" /><div><h4 className="text-sm font-medium text-ink">{destination.name}</h4><p className="mt-1 text-xs text-ink-mute">{destination.detail}</p></div></div>)}</div>
          </div>}
        </div>
        <p className="border-t border-white/[0.07] px-5 py-2.5 text-[9px] leading-relaxed text-ink-mute">{t.disclaimer}</p>
      </div>
    </div>
  );
}

function ClientWorkspaceDemo({ lang }: { lang: Lang }) {
  const [selected, setSelected] = useState(0);
  const clients = [
    { name: "Client A", category: lang === "vi" ? "Thương mại" : "Commerce", spend: "126.4M ₫", revenue: "482.6M ₫", roas: "3.82×", bars: [25, 42, 38, 52, 48, 70, 64, 82, 76, 95] },
    { name: "Client B", category: lang === "vi" ? "Bán lẻ" : "Retail", spend: "84.2M ₫", revenue: "298.1M ₫", roas: "3.54×", bars: [44, 30, 52, 43, 61, 56, 74, 66, 87, 80] },
    { name: "Client C", category: lang === "vi" ? "Phong cách sống" : "Lifestyle", spend: "62.8M ₫", revenue: "271.3M ₫", roas: "4.32×", bars: [20, 32, 29, 44, 51, 46, 68, 78, 72, 94] },
  ];
  const current = clients[selected];
  return (
    <div className="mh-workspace-demo">
      <div className="mh-demo-toolbar"><span className="mh-demo-dot" />{lang === "vi" ? "Workspace của agency" : "Agency workspace"}<span className="mh-demo-label">{lang === "vi" ? "MINH HOẠ" : "ILLUSTRATIVE"}</span></div>
      <div className="mh-client-tabs" role="group" aria-label={lang === "vi" ? "Chọn khách hàng mẫu" : "Choose a sample client"}>
        {clients.map((client, index) => <button type="button" key={client.name} aria-pressed={selected === index} onClick={() => setSelected(index)}><span className="mh-client-avatar">{String.fromCharCode(65 + index)}</span><span>{client.name}<small>{client.category}</small></span><span className="mh-client-selected"><Check size={13} /></span></button>)}
      </div>
      <div className="mh-client-panel" key={selected} aria-live="polite">
        <div className="mh-client-panel-heading"><span>{current.name} <span className="mh-muted">/ {lang === "vi" ? "Tổng quan" : "Overview"}</span></span><span className="mh-demo-label">{lang === "vi" ? "30 NGÀY" : "30 DAYS"}</span></div>
        <div className="mh-client-metrics">{[[lang === "vi" ? "Chi tiêu" : "Spend", current.spend], [lang === "vi" ? "Doanh thu" : "Revenue", current.revenue], ["ROAS", current.roas]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
        <div className="mh-demo-bars" aria-hidden="true">{current.bars.map((height, index) => <span key={index} style={{ height: `${height}%`, animationDelay: `${index * 25}ms` }} />)}</div>
      </div>
      <p className="mh-demo-footnote">{lang === "vi" ? "Chọn khách hàng để khám phá dữ liệu mẫu." : "Select a client to explore the sample data."}</p>
    </div>
  );
}

function DeliveryDemo({ lang }: { lang: Lang }) {
  return (
    <div className="mh-delivery-demo" aria-hidden="true">
      <div className="mh-sheet-window">
        <div className="mh-sheet-title"><IntegrationMark src={INTEGRATION_LOGOS.googleSheets} alt="" size="sm" /><span>{lang === "vi" ? "Báo cáo hiệu suất" : "Performance report"}</span><span className="mh-sheet-status"><Check size={12} /></span></div>
        <div className="mh-sheet-columns"><span /><span>A</span><span>B</span><span>C</span></div>
        {[['1', 'Platform', 'Spend', 'ROAS'], ['2', 'Meta Ads', '58.2M', '4.12×'], ['3', 'Google Ads', '41.6M', '3.64×'], ['4', 'TikTok Ads', '26.6M', '3.45×'], ['5', '', '', '']].map((row) => <div className="mh-sheet-row" key={row[0]}>{row.map((value, i) => <span key={i}>{value || '\u00a0'}</span>)}</div>)}
      </div>
      <div className="mh-delivery-pill"><IntegrationMark src={INTEGRATION_LOGOS.looker} alt="" size="sm" />Looker Studio<ArrowRight size={15} /></div>
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
  const vi = lang === "vi";
  const flow = vi
    ? [["Kết nối", "Ủy quyền các nền tảng bạn đang dùng."], ["Đồng bộ", "Đưa số liệu về một cấu trúc chung."], ["Kiểm tra", "Xem độ mới và tình trạng dữ liệu."], ["Báo cáo", "Làm việc trong Sheets, Looker hoặc API."]]
    : [["Connect", "Authorize the platforms you already use."], ["Sync", "Bring channel metrics into one structure."], ["Review", "Check freshness and source health."], ["Report", "Work in Sheets, Looker, or your API."]];

  return (
    <div lang={lang} className="frontier-home">
      <section className="mh-hero">
        <div className="mh-hero-orbit" aria-hidden="true" />
        <div className="mh-container">
          <MarketingScrollReveal cinematic>
            <div className="mh-eyebrow"><span className="mh-live-dot" />{vi ? "KHÔNG GIAN DỮ LIỆU CHO AGENCY" : "THE AGENCY DATA WORKSPACE"}<span className="mh-eyebrow-index">MONSTERA / 01</span></div>
            <div className="mh-hero-heading">
              <h1>{vi ? "Dữ liệu của bạn." : "Your data."}<br /><span>{vi ? "Toàn cảnh rõ ràng." : "In full view."}</span></h1>
              <div className="mh-hero-aside">
                <p>{vi ? "Gom hiệu suất quảng cáo, doanh thu và dữ liệu khách hàng vào một luồng báo cáo rõ ràng. Để agency dành thời gian cho điều quan trọng hơn." : "Ad performance. Commerce. Every client. One clear reporting workflow—so your agency can focus on what comes next."}</p>
                <div className="mh-actions"><PilotLink location="hero" className="mh-button mh-button-primary">{vi ? "Dùng thử 7 ngày" : "Start your 7-day pilot"}<ArrowRight size={16} /></PilotLink><Link href="#sample-dashboard" className="mh-text-link" onClick={() => trackEvent("landing_sample_dashboard_clicked", { language: lang })}>{vi ? "Khám phá sản phẩm" : "Explore the product"}<span aria-hidden="true">↘</span></Link></div>
                <small>{vi ? "Không cần thẻ. Có hướng dẫn thiết lập." : "No card required. Guided setup included."}</small>
              </div>
            </div>
          </MarketingScrollReveal>
          <MarketingScrollReveal cinematic delay={100} className="mh-product-stage">
            <div className="mh-stage-caption"><span>{vi ? "MỌI TÍN HIỆU. MỘT GÓC NHÌN." : "EVERY SIGNAL. ONE PERSPECTIVE."}</span><span><span className="mh-live-dot" />{vi ? "Khám phá dashboard mẫu" : "Explore the sample dashboard"}</span></div>
            <AgencyControlRoomPreview lang={lang} />
          </MarketingScrollReveal>
        </div>
      </section>

      <section id="integrations" className="mh-integrations mh-container">
        <p className="mh-eyebrow">{vi ? "KẾT NỐI VỚI NHỮNG CÔNG CỤ BẠN ĐANG DÙNG" : "BUILT AROUND THE PLATFORMS YOU ALREADY USE"}</p>
        <div className="mh-provider-row">{PROVIDERS.map((provider) => <Link key={provider.name} href={provider.href}><IntegrationMark src={provider.logo} alt="" size="sm" /><span>{provider.name}</span></Link>)}<span className="mh-provider-divider" /><span className="mh-provider-destination">Google Sheets</span><span className="mh-provider-destination">Looker Studio</span></div>
      </section>

      <section className="mh-stories mh-container">
        <MarketingScrollReveal cinematic className="mh-section-heading"><div><p className="mh-eyebrow">{vi ? "MỘT CÁCH LÀM VIỆC TỐT HƠN" : "A BETTER WAY TO WORK"}</p><h2>{vi ? "Bớt ghép số liệu." : "Less assembling."}<br /><span>{vi ? "Thêm góc nhìn." : "More understanding."}</span></h2></div><p>{vi ? "Từ buổi kiểm tra đầu ngày đến phiên review khách hàng. Đưa số liệu, tình trạng nguồn và báo cáo về cùng một nhịp làm việc." : "From the morning check-in to the client review. Bring performance, data health, and reporting into the same rhythm."}</p></MarketingScrollReveal>
        <div className="mh-story-grid">
          <MarketingScrollReveal cinematic className="mh-story-workspace">
            <article className="mh-story-card mh-dark-card">
              <div className="mh-story-copy"><span className="mh-eyebrow">01 / {vi ? "KHÔNG GIAN KHÁCH HÀNG" : "CLIENT WORKSPACES"}</span><h3>{vi ? "Mỗi khách hàng." : "Every client."}<br /><span>{vi ? "Một không gian riêng." : "A space of their own."}</span></h3><p>{vi ? "Giữ tài khoản, thành viên và lịch sử báo cáo theo từng khách hàng. Chuyển góc nhìn nhanh, giữ phạm vi dữ liệu rõ ràng." : "Keep accounts, people, and reporting history organized by client. Switch perspectives without losing the boundaries."}</p></div>
              <ClientWorkspaceDemo lang={lang} />
            </article>
          </MarketingScrollReveal>
          <MarketingScrollReveal cinematic delay={100} className="mh-story-delivery">
            <article className="mh-story-card mh-light-card">
              <div className="mh-story-copy"><span className="mh-eyebrow">02 / {vi ? "SẴN SÀNG BÁO CÁO" : "REPORTING, READY"}</span><h3>{vi ? "Đến thẳng nơi" : "Straight to where"}<br /><span>{vi ? "team làm việc." : "your team works."}</span></h3><p>{vi ? "Dữ liệu đã chuẩn bị cho Google Sheets, Looker Studio và quy trình báo cáo hiện tại của bạn." : "Prepared data for Google Sheets, Looker Studio, and the reporting workflow you already know."}</p></div>
              <DeliveryDemo lang={lang} />
              <Link href="/looker-studio" className="mh-story-link">{vi ? "Khám phá công cụ báo cáo" : "Explore reporting destinations"}<ArrowRight size={16} /></Link>
            </article>
          </MarketingScrollReveal>
        </div>
        <MarketingScrollReveal cinematic className="mh-health-story">
          <div><span className="mh-eyebrow">03 / {vi ? "TÌNH TRẠNG DỮ LIỆU" : "DATA HEALTH"}</span><h3>{vi ? "Biết điều gì" : "Know what"}<br /><span>{vi ? "cần chú ý." : "needs attention."}</span></h3><p>{vi ? "Phát hiện nguồn cần kết nối lại trước khi số liệu cũ xuất hiện trong báo cáo. Tình trạng kết nối rõ ràng, ngay cạnh dữ liệu." : "Catch a connection that needs attention before stale numbers reach a report. Clear source health, right beside your data."}</p><Link href="/integrations" className="mh-text-link">{vi ? "Xem các tích hợp" : "See the integrations"}<ArrowRight size={16} /></Link></div>
          <div className="mh-health-console"><div className="mh-demo-toolbar"><span className="mh-demo-dot" />{vi ? "Tình trạng nguồn · Minh hoạ" : "Source health · Illustrative"}<span className="mh-demo-label">4 {vi ? "NGUỒN" : "SOURCES"}</span></div>{PROVIDERS.map((provider, index) => <div className="mh-health-row" key={provider.name}><IntegrationMark src={provider.logo} alt="" size="sm" /><span>{provider.name}<small>{index === 3 ? (vi ? "Cần xác thực lại" : "Authorization required") : (vi ? "Dữ liệu sẵn sàng kiểm tra" : "Data ready to review")}</small></span><span className={index === 3 ? "mh-status mh-status-warning" : "mh-status"}><i />{index === 3 ? t.preview.action : t.preview.healthy}</span></div>)}</div>
        </MarketingScrollReveal>
      </section>

      <MarketingProductTour lang={lang} />

      <section id="architecture" className="mh-flow-section">
        <div className="mh-container">
          <MarketingScrollReveal cinematic className="mh-section-heading"><div><p className="mh-eyebrow">{vi ? "TỪ NGUỒN DỮ LIỆU ĐẾN QUYẾT ĐỊNH" : "FROM SOURCE TO PERSPECTIVE"}</p><h2>{vi ? "Một luồng liền mạch." : "One continuous flow."}</h2></div><Link href="/platform" className="mh-text-link">{vi ? "Monstera hoạt động thế nào" : "How Monstera works"}<ArrowRight size={16} /></Link></MarketingScrollReveal>
          <div className="mh-flow-grid">{flow.map(([title, description], index) => <MarketingScrollReveal cinematic key={title} delay={index * 70}><div className="mh-flow-step"><div className="mh-flow-number">0{index + 1}<span /></div><h3>{title}</h3><p>{description}</p></div></MarketingScrollReveal>)}</div>
        </div>
      </section>

      <section id="security" className="mh-trust-section mh-container">
        <MarketingScrollReveal cinematic className="mh-section-heading"><div><p className="mh-eyebrow">{vi ? "ĐƯỢC THIẾT KẾ CÓ CHỦ ĐÍCH" : "CONSIDERED BY DESIGN"}</p><h2>{vi ? "Dữ liệu khách hàng." : "Your clients’ data."}<br /><span>{vi ? "Ranh giới rõ ràng." : "Clear boundaries."}</span></h2></div><ShieldCheck className="mh-trust-symbol" strokeWidth={.7} aria-hidden="true" /></MarketingScrollReveal>
        <div className="mh-trust-grid">{t.security.items.map(([title, description], index) => <MarketingScrollReveal cinematic key={title} delay={index * 55}><span className="mh-eyebrow">0{index + 1}</span><h3>{title}</h3><p>{description}</p></MarketingScrollReveal>)}</div>
      </section>

      <section className="mh-container mh-pilot-section">
        <MarketingScrollReveal cinematic className="mh-pilot"><div className="mh-pilot-intro"><span className="mh-pilot-watermark" aria-hidden="true">07</span><p className="mh-eyebrow">{t.pilot.eyebrow}</p><h2>{t.pilot.title}</h2><p>{t.pilot.description}</p><PilotLink location="pilot" className="mh-button mh-button-primary">{t.pilot.button}<ArrowRight size={16} /></PilotLink><small>{t.pilot.price}</small></div><div className="mh-pilot-steps">{t.pilot.steps.map(([day, description], index) => <div key={day}><span>0{index + 1}</span><div><h3>{day}</h3><p>{description}</p></div></div>)}<p className="mh-pilot-note">{t.pilot.note}</p></div></MarketingScrollReveal>
      </section>

      <section className="mh-faq mh-container"><MarketingScrollReveal cinematic><p className="mh-eyebrow">{t.faq.eyebrow}</p><h2>{vi ? "Câu hỏi thường gặp." : "Good questions."}</h2><p>{vi ? "Những điều cần biết trước khi bắt đầu." : "A few things worth knowing before you start."}</p></MarketingScrollReveal><div>{t.faq.items.map(([question, answer]) => <details key={question}><summary><span>{question}</span><span className="mh-faq-plus" aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

      <section className="mh-final mh-container"><MarketingScrollReveal cinematic><p className="mh-eyebrow">{vi ? "GÓC NHÌN TIẾP THEO CỦA BẠN BẮT ĐẦU TẠI ĐÂY" : "YOUR NEXT PERSPECTIVE STARTS HERE"}</p><h2>{vi ? "Sẵn sàng nhìn rõ hơn?" : "Ready for a clearer view?"}</h2><div className="mh-actions"><PilotLink location="final" className="mh-button mh-button-primary">{t.cta.primary}<ArrowRight size={16} /></PilotLink><Link href="/pricing" className="mh-text-link">{t.cta.secondary}<ArrowRight size={16} /></Link></div></MarketingScrollReveal></section>
    </div>
  );
}
