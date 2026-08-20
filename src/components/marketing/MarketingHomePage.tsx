"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Shield,
  Lock,
  Eye,
  CheckCircle2,
  ShieldCheck,
  FileSpreadsheet,
  Clock,
} from "lucide-react";
import { SignaturePipeline } from "./SignaturePipeline";

const MARKETING_LANG_KEY = "marketing_lang";
type Lang = "en" | "vi";

const COPY = {
  en: {
    hero: {
      eyebrow: "Continuous Marketing Data Engine",
      h1: ["Turn ad & marketplace data", "into client-ready reporting."],
      sub: "Monstera Cloud gives performance marketing agencies one unified warehouse to connect, normalize, and automate reporting across Meta, Google Ads, TikTok, and Shopee — with zero spreadsheet maintenance.",
      cta: "Start 14-day agency pilot",
      ctaSecondary: "See how it works",
      trust: [
        { icon: Shield, text: "Multi-tenant workspace isolation" },
        { icon: Lock, text: "Read-only OAuth 2.0 · AES-256 encrypted" },
        { icon: Eye, text: "Google Sheets™ & Looker Studio™ delivery" },
      ],
    },
    outcomes: {
      eyebrow: "Customer Outcomes",
      title: "Why performance agencies choose Monstera",
      sub: "Eliminate manual data engineering so your media team can focus on client growth and strategy.",
      items: [
        {
          number: "01",
          title: "Stop rebuilding client reporting every week",
          description: "Eliminate repetitive Monday morning CSV exports, broken VLOOKUPs, and currency reconciliation across dozens of client ad accounts.",
          icon: Clock,
          proof: [
            "Manual and nightly warehouse refreshes",
            "Cross-platform spend and conversion harmonization",
            "Zero manual copy-paste spreadsheet glue",
          ],
        },
        {
          number: "02",
          title: "Keep every client workspace strictly isolated",
          description: "Built from the ground up for agencies managing multiple client brands. Strict multi-tenant database partitioning ensures zero cross-client data leakage.",
          icon: ShieldCheck,
          proof: [
            "Logical database fencing per client workspace",
            "Independent OAuth credentials encrypted with AES-256-GCM",
            "Granular role-based member scopes (Admin, Member, Viewer)",
          ],
        },
        {
          number: "03",
          title: "Deliver directly into existing client workflows",
          description: "No need to force clients onto proprietary BI dashboards. Push clean, normalized data into the Google Sheets and Looker Studio templates they already trust.",
          icon: FileSpreadsheet,
          proof: [
            "Official Google Sheets™ automated sync add-on",
            "Live Looker Studio™ certified community connector",
            "Programmatic REST API & high-speed CSV exports",
          ],
        },
      ],
    },
    timeCompare: {
      eyebrow: "Agency Efficiency",
      heading: "Where does your agency's time go?",
      sub: "Every week, manual client reporting steals billable hours from media strategy and growth.",
      steps: [
        { task: "Export CSVs across 8+ client ad accounts", time: "45 min" },
        { task: "Reconcile currency, ROAS & attribution drift", time: "85 min" },
        { task: "Format client slide decks & Google Sheets", time: "60 min" },
        { task: "Repeat for every client next week", time: "Repeat" },
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
    infrastructure: {
      eyebrow: "Security & Reliability",
      title: "Infrastructure guarantees built for client data",
      sub: "Enterprise-grade isolation and strict compliance ensure your agency and client datasets remain confidential.",
      features: [
        {
          title: "Tenant Isolation",
          desc: "Every workspace is logically isolated at the database layer. No cross-client data bleeding.",
        },
        {
          title: "Read-Only OAuth",
          desc: "Monstera cannot edit, publish, pause, or modify client ad campaigns. Read-only telemetry only.",
        },
        {
          title: "AES-256 Encryption",
          desc: "All OAuth access tokens and sensitive refresh credentials are encrypted at rest with AES-256-GCM.",
        },
        {
          title: "Singapore Region Posture",
          desc: "Low-latency regional hosting optimized for Southeast Asia (VN, SG, MY, ID, TH) and global APIs.",
        },
      ],
    },
    finalCta: {
      heading: "Your reporting stack shouldn't need maintenance.",
      sub: "Connect your client sources once. Monstera keeps the warehouse clean and client dashboards reporting-ready.",
      primaryBtn: "Start 14-day agency pilot",
      secondaryBtn: "View documentation",
      trust: "No credit card required · Read-only OAuth · 5-minute setup",
    },
  },
  vi: {
    hero: {
      eyebrow: "Động Cơ Dữ Liệu Marketing Tự Động",
      h1: ["Biến dữ liệu quảng cáo & sàn", "thành báo cáo khách hàng tự động."],
      sub: "Monstera Cloud cung cấp cho agency một kho dữ liệu hợp nhất để kết nối, chuẩn hóa và tự động hóa báo cáo trên Meta, Google Ads, TikTok và Shopee — không còn dọn dẹp bảng tính thủ công.",
      cta: "Bắt đầu dùng thử 14 ngày",
      ctaSecondary: "Xem cách hoạt động",
      trust: [
        { icon: Shield, text: "Tách biệt Workspace đa khách hàng" },
        { icon: Lock, text: "OAuth 2.0 chỉ đọc · Mã hóa AES-256" },
        { icon: Eye, text: "Đẩy thẳng Google Sheets™ & Looker Studio™" },
      ],
    },
    outcomes: {
      eyebrow: "Giá Trị Cho Khách Hàng",
      title: "Vì sao các agency lựa chọn Monstera Cloud",
      sub: "Loại bỏ hoàn toàn công việc kỹ thuật thủ công để đội ngũ media tập trung vào chiến lược tăng trưởng.",
      items: [
        {
          number: "01",
          title: "Không còn làm lại báo cáo thủ công mỗi tuần",
          description: "Chấm dứt thói quen tải CSV sáng thứ Hai, sửa lỗi hàm tính toán và đối chiếu lệch số trên hàng chục tài khoản khách hàng.",
          icon: Clock,
          proof: [
            "Đồng bộ tự động định kỳ hàng giờ và ban đêm",
            "Chuẩn hóa chi phí và lượt chuyển đổi đa kênh",
            "Không còn thao tác copy-paste bảng tính thủ công",
          ],
        },
        {
          number: "02",
          title: "Bảo mật và cách ly tuyệt đối từng Workspace",
          description: "Thiết kế chuẩn mực cho agency quản lý nhiều thương hiệu. Phân vùng cơ sở dữ liệu riêng biệt đảm bảo không rò rỉ dữ liệu chéo.",
          icon: ShieldCheck,
          proof: [
            "Cách ly logic ở tầng cơ sở dữ liệu cho mỗi khách hàng",
            "Mã hóa token xác thực OAuth bằng chuẩn AES-256-GCM",
            "Phân quyền thành viên chặt chẽ (Admin, Member, Viewer)",
          ],
        },
        {
          number: "03",
          title: "Đưa dữ liệu vào thẳng công cụ team đang dùng",
          description: "Không bắt buộc khách hàng học công cụ mới. Đẩy số liệu sạch vào Google Sheets và Looker Studio quen thuộc.",
          icon: FileSpreadsheet,
          proof: [
            "Add-on tự động đồng bộ trên Google Sheets™",
            "Looker Studio™ Community Connector chính thức",
            "Hỗ trợ xuất file CSV và API tốc độ cao",
          ],
        },
      ],
    },
    timeCompare: {
      eyebrow: "Hiệu Quả Cho Agency",
      heading: "Thời gian của agency đang đi đâu?",
      sub: "Mỗi tuần, việc làm báo cáo khách hàng thủ công lấy đi hàng giờ chiến lược của team.",
      steps: [
        { task: "Xuất CSV từ 8+ tài khoản quảng cáo khách hàng", time: "45 phút" },
        { task: "Quy đổi tỷ giá, ROAS & đối chiếu lệch số", time: "85 phút" },
        { task: "Định dạng slide báo cáo & Google Sheets", time: "60 phút" },
        { task: "Lặp lại cho từng khách hàng tuần sau", time: "Lặp lại" },
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
    infrastructure: {
      eyebrow: "Bảo Mật & Độ Tin Cậy",
      title: "Cam kết hạ tầng chuẩn doanh nghiệp",
      sub: "Đảm bảo tính bảo mật và cách ly tuyệt đối giữa các thương hiệu khách hàng trong agency.",
      features: [
        {
          title: "Cách ly đa khách hàng",
          desc: "Mỗi Workspace được phân tách ở tầng cơ sở dữ liệu. Không thể rò rỉ dữ liệu chéo.",
        },
        {
          title: "OAuth chỉ đọc",
          desc: "Monstera không thể chỉnh sửa, bật tắt hay can thiệp vào chiến dịch quảng cáo.",
        },
        {
          title: "Mã hóa AES-256",
          desc: "Mọi token xác thực OAuth được mã hóa ở trạng thái nghỉ với chuẩn AES-256-GCM.",
        },
        {
          title: "Hạ tầng khu vực Singapore",
          desc: "Độ trễ thấp tối ưu cho khu vực Đông Nam Á và kết nối API quốc tế ổn định.",
        },
      ],
    },
    finalCta: {
      heading: "Hệ thống báo cáo của bạn không nên tốn công bảo trì.",
      sub: "Kết nối nguồn dữ liệu một lần. Monstera giữ kho dữ liệu luôn sạch và báo cáo luôn sẵn sàng.",
      primaryBtn: "Bắt đầu dùng thử 14 ngày",
      secondaryBtn: "Xem tài liệu hướng dẫn",
      trust: "Không cần thẻ tín dụng · OAuth chỉ đọc · Cài đặt 5 phút",
    },
  },
} as const;

export default function MarketingHomePage() {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(MARKETING_LANG_KEY);
    if (saved === "en" || saved === "vi") setLang(saved);

    const onLangChange = (e: CustomEvent<Lang>) => {
      setLang(e.detail);
    };
    window.addEventListener("marketing-lang-change" as any, onLangChange as any);
    return () => window.removeEventListener("marketing-lang-change" as any, onLangChange as any);
  }, []);

  const t = COPY[lang];

  return (
    <div className="space-y-28 sm:space-y-36 pb-20">
      {/* ── 1. HERO SECTION ── */}
      <section className="relative pt-12 sm:pt-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          {/* Eyebrow badge */}
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[11px] font-medium text-ink-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>{t.hero.eyebrow}</span>
          </div>

          {/* Main Headline — Adjusted second line contrast */}
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-6xl sm:leading-[1.1]">
            <span className="block">{t.hero.h1[0]}</span>
            <span className="block text-neutral-300 mt-1">{t.hero.h1[1]}</span>
          </h1>

          {/* Subtitle */}
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-mute sm:text-lg">
            {t.hero.sub}
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-neutral-950 shadow-xs transition-colors hover:bg-neutral-200"
            >
              {t.hero.cta}
              <ArrowRight className="ml-2 h-4 w-4" strokeWidth={2} />
            </Link>
            <a
              href="#pipeline"
              className="inline-flex items-center justify-center rounded-md border border-line bg-panel px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-white/[0.04]"
            >
              {t.hero.ctaSecondary}
            </a>
          </div>

          {/* Trust Guarantees */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-xs text-ink-mute">
            {t.hero.trust.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div key={idx} className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
                  <span>{item.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 2. SIGNATURE INTERACTIVE PIPELINE VISUAL ── */}
      <section id="pipeline" className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                Product Architecture
              </p>
              <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl mt-1">
                Connect → Normalize → Warehouse → Deliver
              </h2>
            </div>
            <p className="text-xs text-ink-mute max-w-md">
              A continuous ETL engine bridging disparate advertising APIs directly into clean client reporting.
            </p>
          </div>

          <SignaturePipeline />
        </div>
      </section>

      {/* ── 3. THREE OUTCOME-LED VALUE SECTIONS ── */}
      <section className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
              {t.outcomes.eyebrow}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {t.outcomes.title}
            </h2>
            <p className="mt-3 text-sm text-ink-mute leading-relaxed">
              {t.outcomes.sub}
            </p>
          </div>

          {/* 3 Outcome Cards */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {t.outcomes.items.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.number}
                  className="flex flex-col justify-between rounded-xl border border-line bg-panel p-6 sm:p-7 space-y-6 transition-colors hover:border-white/20"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-mono text-xs font-semibold text-ink-mute">
                        {item.number}
                      </span>
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-ink">
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                      </div>
                    </div>

                    <h3 className="text-base font-semibold text-ink leading-snug mb-3">
                      {item.title}
                    </h3>
                    <p className="text-xs leading-relaxed text-ink-mute mb-5">
                      {item.description}
                    </p>
                  </div>

                  <div className="border-t border-line pt-4 space-y-2">
                    {item.proof.map((p, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-ink-mute">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 4. AGENCY EFFICIENCY / ROI MATRIX ── */}
      <section className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl rounded-xl border border-line bg-panel p-6 sm:p-10">
          <div className="mb-8 text-center max-w-xl mx-auto">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-mute mb-2">
              {t.timeCompare.eyebrow}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {t.timeCompare.heading}
            </h2>
            <p className="mt-2 text-sm text-ink-mute">
              {t.timeCompare.sub}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Manual Reporting Column */}
            <div className="rounded-lg border border-line/80 bg-canvas p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="text-xs font-semibold text-ink-mute uppercase tracking-wider">
                  Manual Spreadsheets
                </span>
                <span className="font-mono text-sm font-bold text-red-400">
                  {t.timeCompare.total} <span className="text-[10px] font-normal text-ink-mute">{t.timeCompare.unit}</span>
                </span>
              </div>
              <div className="space-y-3">
                {t.timeCompare.steps.map((step, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-ink-mute">{step.task}</span>
                    <span className="font-mono text-ink text-[11px] shrink-0 ml-2">{step.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Monstera Cloud Column */}
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-5 space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                    {t.timeCompare.after.label}
                  </span>
                  <span className="font-mono text-sm font-bold text-emerald-400">
                    {t.timeCompare.after.total} <span className="text-[10px] font-normal text-ink-mute">{t.timeCompare.after.unit}</span>
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-xs">
                  <p className="text-ink font-medium leading-relaxed">
                    {t.timeCompare.after.tagline}
                  </p>
                  <p className="text-ink-mute text-[11px]">
                    {t.timeCompare.after.setup}
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-line">
                <Link
                  href="/register"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-white py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-200 transition-colors"
                >
                  Reclaim your agency hours <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. SECURITY & INFRASTRUCTURE GUARANTEES ── */}
      <section className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center max-w-xl mx-auto">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-mute mb-2">
              {t.infrastructure.eyebrow}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {t.infrastructure.title}
            </h2>
            <p className="mt-2 text-sm text-ink-mute">
              {t.infrastructure.sub}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.infrastructure.features.map((feat, idx) => (
              <div key={idx} className="rounded-lg border border-line bg-panel p-5 space-y-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-canvas text-ink mb-3">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.5} />
                </div>
                <h3 className="text-sm font-semibold text-ink">{feat.title}</h3>
                <p className="text-xs leading-relaxed text-ink-mute">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. FINAL MARKETING CTA ── */}
      <section className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-2xl border border-line bg-panel p-8 sm:p-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {t.finalCta.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-mute sm:text-base">
            {t.finalCta.sub}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 shadow-xs hover:bg-neutral-200 transition-colors"
            >
              {t.finalCta.primaryBtn}
              <ArrowRight className="ml-2 h-4 w-4" strokeWidth={2} />
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center justify-center rounded-md border border-line bg-canvas px-5 py-2.5 text-sm font-medium text-ink hover:bg-white/[0.04] transition-colors"
            >
              {t.finalCta.secondaryBtn}
            </Link>
          </div>

          <p className="mt-6 font-mono text-[11px] text-ink-mute">
            {t.finalCta.trust}
          </p>
        </div>
      </section>
    </div>
  );
}
