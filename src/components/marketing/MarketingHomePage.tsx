"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Database, Eye, FileSpreadsheet, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { SignaturePipeline } from "./SignaturePipeline";
import { MarketingScrollReveal } from "./MarketingScrollReveal";

const MARKETING_LANG_KEY = "marketing_lang";
type Lang = "en" | "vi";

const COPY = {
  en: {
    hero: {
      eyebrow: "Marketing data, made usable",
      title: ["Your ad data, cleaned", "and ready to report."],
      description: "Connect Meta, Google Ads, TikTok, and Shopee. Monstera normalizes your marketing data and keeps a reporting warehouse ready for the tools your team already uses.",
      primary: "Start free",
      secondary: "See how it works",
    },
    trust: [
      { icon: Eye, label: "Read-only provider access where available" },
      { icon: Lock, label: "Credentials encrypted at rest" },
      { icon: ShieldCheck, label: "Workspace-scoped data" },
      { icon: Sparkles, label: "On-demand and scheduled syncs" },
    ],
    providers: { label: "Connect the platforms already in your reporting mix" },
    outcomes: {
      eyebrow: "What changes",
      title: "Less reporting maintenance. More confidence in the numbers.",
      description: "Monstera gives your team a consistent starting point for analysis—without asking everyone to change the way they already report.",
      items: [
        { title: "One reporting structure", description: "Platform metrics are mapped into a consistent warehouse so campaigns can be reviewed together.", points: ["Consistent dimensions and metrics", "Currency-aware records", "Historical data stays organized"], icon: Database },
        { title: "Data that is ready when you are", description: "Refresh a selected window when you need it, or keep your reporting data up to date with scheduled syncs.", points: ["Visible source and sync status", "Freshness is easy to inspect", "Retryable work is handled deliberately"], icon: CheckCircle2 },
        { title: "Keep the tools your team knows", description: "Explore, export, or deliver prepared data into the reporting workflows that already support your decisions.", points: ["Warehouse explorer", "CSV and API export", "Google Sheets and Looker Studio workflows"], icon: FileSpreadsheet },
      ],
    },
    audiences: {
      eyebrow: "Built for the people close to performance",
      title: "A clearer handoff from platform data to reporting.",
      items: [
        ["Marketing teams", "Bring channel data into one dependable reporting foundation."],
        ["Agencies", "Keep client workspaces distinct while making recurring reporting easier to run."],
        ["Operators & founders", "See the reporting picture without rebuilding data flows from scratch."],
      ],
    },
    security: {
      eyebrow: "Security without the theatre",
      title: "Clear boundaries for the data you connect.",
      items: [
        ["Authorize, don’t share", "Where a provider supports OAuth, you authorize Monstera through that provider instead of sharing a password."],
        ["Read-only by design", "Advertising integrations request the access needed to retrieve reporting data; they do not edit campaigns."],
        ["Credentials protected", "Connected credentials are encrypted at rest, and data is scoped to its workspace."],
        ["You stay in control", "Connections can be reviewed, disconnected, and re-authorized from the product."],
      ],
    },
    cta: {
      title: "Make reporting the easy part of your marketing stack.",
      description: "Connect your sources once, then keep the data ready for the next question your team needs to answer.",
      primary: "Start free",
      secondary: "Read the docs",
      note: "No credit card required · Connect only the sources you choose",
    },
  },
  vi: {
    hero: {
      eyebrow: "Dữ liệu marketing, sẵn sàng để sử dụng",
      title: ["Dữ liệu quảng cáo được làm sạch", "và sẵn sàng cho báo cáo."],
      description: "Kết nối Meta, Google Ads, TikTok và Shopee. Monstera chuẩn hóa dữ liệu marketing và duy trì kho dữ liệu báo cáo sẵn sàng cho các công cụ team bạn đang dùng.",
      primary: "Bắt đầu miễn phí",
      secondary: "Xem cách hoạt động",
    },
    trust: [
      { icon: Eye, label: "Quyền truy cập chỉ đọc khi nền tảng hỗ trợ" },
      { icon: Lock, label: "Thông tin xác thực được mã hóa khi lưu trữ" },
      { icon: ShieldCheck, label: "Dữ liệu được phân tách theo workspace" },
      { icon: Sparkles, label: "Đồng bộ theo yêu cầu hoặc theo lịch" },
    ],
    providers: { label: "Kết nối các nền tảng đã có trong báo cáo của bạn" },
    outcomes: {
      eyebrow: "Điều gì thay đổi",
      title: "Ít công bảo trì báo cáo hơn. Tin tưởng số liệu hơn.",
      description: "Monstera tạo một điểm bắt đầu nhất quán để phân tích mà không buộc mọi người phải thay đổi cách họ đang báo cáo.",
      items: [
        { title: "Một cấu trúc cho báo cáo", description: "Số liệu từ các nền tảng được ánh xạ vào một kho dữ liệu thống nhất để có thể xem chiến dịch cùng nhau.", points: ["Dimension và metric nhất quán", "Bản ghi có nhận biết tiền tệ", "Dữ liệu lịch sử được tổ chức gọn gàng"], icon: Database },
        { title: "Dữ liệu sẵn sàng khi bạn cần", description: "Làm mới khoảng thời gian đã chọn khi cần hoặc duy trì dữ liệu báo cáo theo lịch đồng bộ.", points: ["Thấy rõ trạng thái nguồn và đồng bộ", "Dễ kiểm tra độ mới của dữ liệu", "Công việc có thể thử lại được xử lý có chủ đích"], icon: CheckCircle2 },
        { title: "Giữ công cụ team đã quen dùng", description: "Khám phá, xuất hoặc đưa dữ liệu đã chuẩn bị vào luồng báo cáo đang hỗ trợ các quyết định của team.", points: ["Warehouse explorer", "Xuất CSV và API", "Luồng Google Sheets và Looker Studio"], icon: FileSpreadsheet },
      ],
    },
    audiences: {
      eyebrow: "Dành cho những người sát với hiệu quả marketing",
      title: "Bàn giao rõ ràng hơn từ dữ liệu nền tảng đến báo cáo.",
      items: [
        ["Marketing teams", "Đưa dữ liệu kênh về một nền tảng báo cáo đáng tin cậy."],
        ["Agencies", "Giữ workspace khách hàng tách biệt và vận hành báo cáo định kỳ dễ hơn."],
        ["Operators & founders", "Nắm bức tranh báo cáo mà không cần tự xây lại luồng dữ liệu."],
      ],
    },
    security: {
      eyebrow: "Bảo mật rõ ràng, không phô trương",
      title: "Ranh giới minh bạch cho dữ liệu bạn kết nối.",
      items: [
        ["Ủy quyền, không chia sẻ", "Khi nền tảng hỗ trợ OAuth, bạn cấp quyền Monstera qua nền tảng đó thay vì chia sẻ mật khẩu."],
        ["Thiết kế chỉ đọc", "Các tích hợp quảng cáo chỉ yêu cầu quyền cần thiết để lấy dữ liệu báo cáo; không chỉnh sửa chiến dịch."],
        ["Thông tin xác thực được bảo vệ", "Thông tin xác thực đã kết nối được mã hóa khi lưu trữ và dữ liệu được phân tách theo workspace."],
        ["Bạn luôn kiểm soát", "Kết nối có thể được xem lại, ngắt và cấp quyền lại ngay trong sản phẩm."],
      ],
    },
    cta: {
      title: "Hãy để báo cáo trở thành phần dễ nhất trong marketing stack.",
      description: "Kết nối nguồn dữ liệu một lần, sau đó giữ dữ liệu sẵn sàng cho câu hỏi tiếp theo của team.",
      primary: "Bắt đầu miễn phí",
      secondary: "Đọc tài liệu",
      note: "Không cần thẻ tín dụng · Chỉ kết nối các nguồn bạn chọn",
    },
  },
} as const;

const PROVIDERS = [
  { name: "Meta Ads", logo: INTEGRATION_LOGOS.meta },
  { name: "Google Ads", logo: INTEGRATION_LOGOS.googleAds },
  { name: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok },
  { name: "Shopee", logo: INTEGRATION_LOGOS.shopee },
];

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
    <div className="overflow-x-clip pb-20">
      <section className="relative isolate px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.075),transparent_62%)]" />
        <MarketingScrollReveal className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 font-mono text-[11px] font-medium text-ink-mute"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{t.hero.eyebrow}</div>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.045em] text-ink sm:text-6xl lg:text-7xl lg:leading-[1.02]"><span className="block">{t.hero.title[0]}</span><span className="mt-1 block text-neutral-400">{t.hero.title[1]}</span></h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-ink-mute sm:text-lg">{t.hero.description}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register" className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-canvas">{t.hero.primary}<ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link>
            <a href="#architecture" className="inline-flex items-center justify-center rounded-md border border-line bg-panel px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-canvas">{t.hero.secondary}</a>
          </div>
        </MarketingScrollReveal>
      </section>

      <section aria-label="Trust signals" className="border-y border-line bg-panel/35 px-4 py-5 sm:px-6 lg:px-8"><MarketingScrollReveal className="mx-auto grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-4">{t.trust.map(({ icon: Icon, label }) => <div key={label} className="flex items-center gap-2.5 px-2 text-xs leading-snug text-ink-mute"><Icon className="h-4 w-4 shrink-0 text-ink" strokeWidth={1.5} aria-hidden /><span>{label}</span></div>)}</MarketingScrollReveal></section>

      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8"><MarketingScrollReveal className="mx-auto max-w-6xl"><p className="mb-6 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">{t.providers.label}</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{PROVIDERS.map((provider) => <div key={provider.name} className="flex h-16 items-center justify-center gap-3 rounded-lg border border-line bg-panel px-4"><IntegrationMark src={provider.logo} alt="" size="sm" /><span className="text-sm font-medium text-ink">{provider.name}</span></div>)}</div></MarketingScrollReveal></section>

      <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8"><div className="mx-auto max-w-6xl"><MarketingScrollReveal className="max-w-2xl"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">{t.outcomes.eyebrow}</p><h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.outcomes.title}</h2><p className="mt-4 text-base leading-relaxed text-ink-mute">{t.outcomes.description}</p></MarketingScrollReveal><div className="mt-10 grid gap-4 md:grid-cols-3">{t.outcomes.items.map((item, index) => { const Icon = item.icon; return <MarketingScrollReveal key={item.title} delay={index * 70} className="h-full"><article className="flex h-full flex-col rounded-xl border border-line bg-panel p-6 transition-colors hover:border-white/20"><div className="mb-8 flex items-center justify-between"><span className="font-mono text-xs text-ink-mute">0{index + 1}</span><span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-canvas"><Icon className="h-4 w-4 text-ink" strokeWidth={1.5} aria-hidden /></span></div><h3 className="text-lg font-semibold text-ink">{item.title}</h3><p className="mt-3 text-sm leading-relaxed text-ink-mute">{item.description}</p><ul className="mt-6 space-y-2 border-t border-line pt-5 text-xs leading-relaxed text-ink-mute">{item.points.map((point) => <li key={point} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />{point}</li>)}</ul></article></MarketingScrollReveal>; })}</div></div></section>

      <section id="architecture" className="scroll-mt-20 border-y border-line bg-panel/30 px-4 py-20 sm:px-6 sm:py-28 lg:px-8"><div className="mx-auto max-w-6xl"><MarketingScrollReveal className="mb-10 grid gap-4 md:grid-cols-[1fr_auto] md:items-end"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">How it works</p><h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Connect → Normalize → Warehouse → Deliver</h2></div><p className="max-w-md text-sm leading-relaxed text-ink-mute">Start with the platform account. The reporting-ready structure is the result—not the burden your team has to manage.</p></MarketingScrollReveal><MarketingScrollReveal><SignaturePipeline /></MarketingScrollReveal></div></section>

      <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8"><div className="mx-auto max-w-6xl"><MarketingScrollReveal className="max-w-2xl"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">{t.audiences.eyebrow}</p><h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.audiences.title}</h2></MarketingScrollReveal><div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">{t.audiences.items.map(([title, description], index) => <MarketingScrollReveal key={title} delay={index * 70} className="bg-panel"><article className="min-h-40 p-6"><span className="font-mono text-[11px] text-ink-mute">0{index + 1}</span><h3 className="mt-6 text-lg font-semibold text-ink">{title}</h3><p className="mt-2 text-sm leading-relaxed text-ink-mute">{description}</p></article></MarketingScrollReveal>)}</div></div></section>

      <section id="security" className="scroll-mt-20 border-y border-line bg-panel/30 px-4 py-20 sm:px-6 sm:py-28 lg:px-8"><div className="mx-auto max-w-6xl"><MarketingScrollReveal className="max-w-2xl"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">{t.security.eyebrow}</p><h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.security.title}</h2></MarketingScrollReveal><div className="mt-10 grid gap-4 sm:grid-cols-2">{t.security.items.map(([title, description], index) => <MarketingScrollReveal key={title} delay={index * 70}><article className="rounded-lg border border-line bg-canvas p-6"><span className="font-mono text-[11px] text-emerald-400">0{index + 1}</span><h3 className="mt-5 text-base font-semibold text-ink">{title}</h3><p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-mute">{description}</p></article></MarketingScrollReveal>)}</div></div></section>

      <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8"><MarketingScrollReveal className="mx-auto max-w-4xl rounded-2xl border border-line bg-panel px-6 py-12 text-center sm:px-12"><h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.cta.title}</h2><p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-ink-mute">{t.cta.description}</p><div className="mt-8 flex flex-wrap justify-center gap-3"><Link href="/register" className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200">{t.cta.primary}<ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link><Link href="/docs" className="inline-flex items-center justify-center rounded-md border border-line bg-canvas px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.04]">{t.cta.secondary}</Link></div><p className="mt-6 font-mono text-[11px] text-ink-mute">{t.cta.note}</p></MarketingScrollReveal></section>
    </div>
  );
}
