"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCheck, Database, Download, FileText, LayoutGrid, ShieldCheck } from "lucide-react";
import { MarketingScrollReveal } from "./MarketingScrollReveal";
import "./marketing-product-tour.css";

type Lang = "en" | "vi";
const CHANNELS = ["All", "Meta Ads", "Google Ads", "TikTok Ads"] as const;
const ROWS = [
  { campaign: "Summer collection", platform: "Meta Ads", spend: 28.4, revenue: 119.28 },
  { campaign: "Returning customers", platform: "Meta Ads", spend: 18.6, revenue: 87.42 },
  { campaign: "Brand search", platform: "Google Ads", spend: 24.8, revenue: 109.12 },
  { campaign: "Shopping discovery", platform: "Google Ads", spend: 16.8, revenue: 52.08 },
  { campaign: "Creator collection", platform: "TikTok Ads", spend: 26.6, revenue: 87.78 },
];
const TOTAL_SPEND = ROWS.reduce((sum, row) => sum + row.spend, 0);
const TOTAL_REVENUE = ROWS.reduce((sum, row) => sum + row.revenue, 0);
const MONEY = (value: number) => `${value.toFixed(1)}M ₫`;

function ExplorerDemo({ vi }: { vi: boolean }) {
  const [channel, setChannel] = useState<string>("All");
  const rows = ROWS.filter(row => channel === "All" || row.platform === channel);
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  return <>
    <div className="mtour-demo-title"><div><span className="mtour-label">DATA EXPLORER</span><h3>{vi ? "Đi sâu vào từng kênh." : "Find the story in every channel."}</h3></div><Database size={22} strokeWidth={1.2} /></div>
    <div className="mtour-filters" role="group" aria-label={vi ? "Lọc nền tảng mẫu" : "Filter sample platforms"}>{CHANNELS.map(name => <button type="button" key={name} aria-pressed={channel === name} onClick={() => setChannel(name)}>{name === "All" ? (vi ? "Tất cả" : "All platforms") : name}</button>)}</div>
    <div className="mtour-results" aria-live="polite" aria-atomic="true">
      <div className="mtour-totals"><div><span>{vi ? "Chi tiêu" : "Spend"}</span><strong>{MONEY(spend)}</strong></div><div><span>{vi ? "Doanh thu nền tảng" : "Provider revenue"}</span><strong>{MONEY(revenue)}</strong></div><div><span>ROAS</span><strong>{(revenue / spend).toFixed(2)}×</strong></div></div>
      <div className="mtour-table-wrap"><table><caption className="sr-only">{vi ? "Số liệu chiến dịch minh hoạ" : "Illustrative campaign performance"}</caption><thead><tr><th>{vi ? "Chiến dịch / Nền tảng" : "Campaign / Platform"}</th><th>{vi ? "Chi tiêu" : "Spend"}</th><th>ROAS</th><th className="mtour-share-heading">{vi ? "Tỷ trọng chi tiêu" : "Spend share"}</th></tr></thead><tbody>{rows.map(row => <tr key={row.campaign}><td>{row.campaign}<small>{row.platform}</small></td><td>{MONEY(row.spend)}</td><td>{(row.revenue / row.spend).toFixed(2)}×</td><td className="mtour-share-cell"><span className="mtour-share"><i style={{ width: `${row.spend / spend * 100}%` }} /></span></td></tr>)}</tbody></table></div>
      <div className="mtour-result-footer"><span>{rows.length} {vi ? "chiến dịch mẫu" : "sample campaigns"}</span><span>VND · {vi ? "Số liệu nền tảng" : "Provider-reported"}</span></div>
    </div>
    <p className="mtour-hint">{vi ? "Thử chọn một nền tảng để xem bảng và KPI thay đổi." : "Choose a platform. Watch the table and KPIs respond."}</p>
  </>;
}

function ReadinessDemo({ vi }: { vi: boolean }) {
  const [missing, setMissing] = useState(false);
  return <>
    <div className="mtour-demo-title"><div><span className="mtour-label">REPORT READINESS</span><h3>{vi ? "Rõ dữ liệu. Tự tin review." : "Know what’s behind the numbers."}</h3></div><ShieldCheck size={24} strokeWidth={1.2} /></div>
    <div className="mtour-filters" role="group" aria-label={vi ? "Tình huống dữ liệu mẫu" : "Sample data scenario"}><button type="button" aria-pressed={!missing} onClick={() => setMissing(false)}>{vi ? "Đủ dữ liệu" : "Complete window"}</button><button type="button" aria-pressed={missing} onClick={() => setMissing(true)}>{vi ? "Thiếu một ngày" : "A missing day"}</button></div>
    <div aria-live="polite" aria-atomic="true" className="mtour-readiness">
      <div className={`mtour-readiness-banner ${missing ? "mtour-warning" : ""}`}><ShieldCheck size={26} strokeWidth={1.3} /><div><strong>{missing ? (vi ? "Cần kiểm tra dữ liệu" : "A gap worth checking") : (vi ? "Bằng chứng dữ liệu đầy đủ" : "Saved evidence checks passed")}</strong><p>{missing ? (vi ? "TikTok Ads thiếu ngày 06 trong khoảng báo cáo mẫu." : "TikTok Ads is missing day 06 in this sample window.") : (vi ? "Các nguồn mẫu có đủ 7 ngày trong khoảng báo cáo." : "All sample sources cover the seven-day reporting window.")}</p></div></div>
      <div className="mtour-coverage"><div className="mtour-coverage-row mtour-coverage-head"><span>{vi ? "Độ phủ dữ liệu" : "Date coverage"}</span>{[1,2,3,4,5,6,7].map(day => <span key={day}>0{day}</span>)}</div>{CHANNELS.slice(1).map((name, i) => <div key={name} className="mtour-coverage-row"><span>{name}</span>{[1,2,3,4,5,6,7].map(day => { const gap = missing && i === 2 && day === 6; return <span key={day} className={gap ? "mtour-day mtour-day-gap" : "mtour-day"} aria-label={`${name}, ${vi ? "ngày" : "day"} ${day}: ${gap ? (vi ? "thiếu" : "missing") : (vi ? "có dữ liệu" : "present")}`}>{gap ? "−" : <Check size={12} />}</span>; })}</div>)}</div>
      <div className="mtour-evidence"><span><CheckCheck size={15} />{vi ? "Một đơn vị tiền tệ" : "One reporting currency"}<b>VND</b></span><span><CheckCheck size={15} />{vi ? "Khoảng báo cáo" : "Reporting window"}<b>01–07 Sep</b></span></div>
    </div>
    <p className="mtour-hint">{vi ? "Kiểm tra mang tính tham khảo từ bằng chứng đã lưu; không thay thế đối soát với nền tảng." : "Advisory checks from saved evidence. Reconcile figures with each provider."}</p>
  </>;
}

function ExportDemo({ vi }: { vi: boolean }) {
  const [format, setFormat] = useState<"brief" | "workbook">("brief");
  return <>
    <div className="mtour-demo-title"><div><span className="mtour-label">CLIENT EXPORTS</span><h3>{vi ? "Từ số liệu đến buổi review." : "Make the handoff feel effortless."}</h3></div><FileText size={24} strokeWidth={1.2} /></div>
    <div className="mtour-filters" role="group" aria-label={vi ? "Định dạng báo cáo mẫu" : "Sample report format"}><button type="button" aria-pressed={format === "brief"} onClick={() => setFormat("brief")}>{vi ? "Bản tóm tắt" : "Client brief"}</button><button type="button" aria-pressed={format === "workbook"} onClick={() => setFormat("workbook")}>{vi ? "Cấu trúc Excel" : "Excel structure"}</button></div>
    <div className="mtour-export-preview" key={format}>
      <div className="mtour-document"><span className="mtour-label">MONSTERA / CLIENT A</span><h4>{vi ? "Hiệu suất, nhìn rõ hơn." : "Performance, in perspective."}</h4><p className="mtour-document-date">01–07 Sep · {vi ? "Báo cáo mẫu" : "Sample report"}</p>{format === "brief" ? <><div className="mtour-document-metrics"><span>{MONEY(TOTAL_SPEND)}<small>{vi ? "Chi tiêu" : "Spend"}</small></span><span>{MONEY(TOTAL_REVENUE)}<small>{vi ? "Doanh thu nền tảng" : "Provider revenue"}</small></span><span>{(TOTAL_REVENUE / TOTAL_SPEND).toFixed(2)}×<small>ROAS</small></span></div><p>{vi ? "Tổng quan KPI, kết quả theo nền tảng và chiến dịch hàng đầu trong một bản tóm tắt để chia sẻ." : "Overall KPIs, platform breakdowns, and top campaigns in one brief you can share."}</p><div className="mtour-document-rule" /><p className="mtour-document-note">{vi ? "Nguồn: dữ liệu minh hoạ · Đơn vị: VND" : "Source: illustrative data · Currency: VND"}</p></> : <div className="mtour-workbook">{[vi ? "Tóm tắt điều hành" : "Executive summary",vi ? "Phân tích nền tảng" : "Platform breakdown",vi ? "Chiến dịch hàng đầu" : "Top campaigns",vi ? "Dữ liệu chi tiết" : "Granular records"].map((label, i) => <div key={label}><span>0{i + 1}</span><FileText size={15} />{label}<Check size={13} /></div>)}</div>}</div>
    </div>
    <a className="mtour-download" href="/monstera-illustrative-campaigns.csv" download="monstera-illustrative-campaigns.csv"><Download size={15} />{vi ? "Tải CSV minh hoạ" : "Download the sample CSV"}<ArrowRight size={14} /></a>
  </>;
}

export function MarketingProductTour({ lang }: { lang: Lang }) {
  const vi = lang === "vi";
  const [active, setActive] = useState(0);
  const chapters = vi ? [
    { title: "Khám phá dữ liệu", body: "Lọc theo nền tảng, kiểm tra từng chiến dịch và nhìn rõ các KPI trong Data Explorer.", note: "Chọn một kênh. Xem điều gì thay đổi.", icon: Database },
    { title: "Kiểm tra trước khi báo cáo", body: "Xem độ phủ ngày, tình trạng nguồn và bằng chứng dữ liệu trước buổi review khách hàng.", note: "Thử tình huống thiếu dữ liệu.", icon: ShieldCheck },
    { title: "Chuẩn bị để chia sẻ", body: "Tạo bản tóm tắt khách hàng, file Excel nhiều trang hoặc CSV từ dữ liệu đã chọn.", note: "Xem bản tóm tắt. Tải dữ liệu mẫu.", icon: FileText },
  ] : [
    { title: "Explore the detail", body: "Filter platforms, inspect campaigns, and see the KPIs behind the overview in Data Explorer.", note: "Pick a channel. See what changes.", icon: Database },
    { title: "Check before you report", body: "Review date coverage, source health, and saved evidence before your next client review.", note: "Try the missing-data scenario.", icon: ShieldCheck },
    { title: "Prepare to share", body: "Turn selected data into a client brief, a multi-sheet Excel workbook, or a CSV export.", note: "Preview the brief. Take the sample data.", icon: FileText },
  ];
  return <section id="product-tour" className="mtour-section"><div className="mh-container">
    <MarketingScrollReveal cinematic className="mtour-intro"><p className="mh-eyebrow">{vi ? "KHÁM PHÁ MONSTERA" : "GET TO KNOW MONSTERA"}</p><h2>{vi ? "Đằng sau mỗi con số." : "Behind every number."}<br /><span>{vi ? "Một cách làm việc rõ ràng hơn." : "A clearer way to work."}</span></h2><p>{vi ? "Khám phá ba bước từ dữ liệu nền tảng đến báo cáo khách hàng. Thử trực tiếp bên dưới." : "Follow the journey from channel data to a client-ready conversation. Try it for yourself below."}</p></MarketingScrollReveal>
    <MarketingScrollReveal cinematic className="mtour-layout">
      <div className="mtour-chapters"><div className="mtour-chapter-list" role="group" aria-label={vi ? "Khám phá tính năng" : "Product tour chapters"}>{chapters.map((chapter, i) => <button type="button" key={i} aria-pressed={active === i} aria-controls="mtour-demo" onClick={() => setActive(i)} className="mtour-chapter"><span className="mtour-chapter-number">0{i + 1}</span><span><strong>{chapter.title}</strong><span className="mtour-chapter-body">{chapter.body}</span></span><ArrowRight size={16} /></button>)}</div><Link href="/platform" className="mh-text-link">{vi ? "Xem toàn bộ sản phẩm" : "Explore the whole product"}<ArrowRight size={15} /></Link></div>
      <div className="mtour-window"><div className="mtour-window-bar"><span className="mtour-window-brand"><LayoutGrid size={14} />Monstera</span><span>Client A <i>/</i> {vi ? "Dữ liệu mẫu" : "Sample workspace"}</span><span className="mtour-sample">{vi ? "MINH HOẠ" : "ILLUSTRATIVE"}</span></div><div id="mtour-demo" role="region" aria-label={chapters[active].title} className="mtour-demo"><div className="mtour-view" key={active}>{active === 0 ? <ExplorerDemo vi={vi} /> : active === 1 ? <ReadinessDemo vi={vi} /> : <ExportDemo vi={vi} />}</div></div><div className="mtour-window-foot"><span className="mh-live-dot" />{chapters[active].note}<span>0{active + 1} / 03</span></div></div>
    </MarketingScrollReveal>
    <p className="mtour-disclaimer">{vi ? "Demo tương tác với số liệu minh hoạ. Không kết nối tài khoản thật." : "Interactive demonstrations with illustrative data. No connected accounts."}</p>
  </div></section>;
}
