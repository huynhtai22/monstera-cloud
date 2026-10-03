"use client";

import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { MarketingScrollReveal } from "@/components/marketing/MarketingScrollReveal";
import "@/components/marketing/marketing-page-polish.css";
import "./pricing-frontier.css";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BillingCycleSwitch, PlanOptions } from "@/components/pricing/PlanOptions";
import { agencyProAmount, type BillingCycle, type BillingCurrency, type PricingLanguage } from "@/lib/public-plan-catalog";
import { VietQrModal } from "@/components/pricing/VietQrModal";
import { metaPixelCustom } from "@/lib/meta-pixel";

function PricingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [currency, setCurrency] = useState<BillingCurrency>("VND");
  const [language, setLanguage] = useState<PricingLanguage>("en");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const vi = language === "vi";
  const monthlyPrice = `${agencyProAmount("monthly").toLocaleString("vi-VN")} ₫`;
  const annualPrice = `${agencyProAmount("annual").toLocaleString("vi-VN")} ₫`;
  const steps = vi ? [
    ["01 / Dùng thử", "Bảy ngày để kiểm tra quy trình: kết nối nguồn, nhập dữ liệu gần đây và xem bảng KPI trước khi quyết định."],
    ["02 / Tiếp tục", `Thanh toán ${monthlyPrice} cho 30 ngày hoặc ${annualPrice} cho 365 ngày. Chỉ gia hạn sau khi PayOS xác minh giao dịch.`],
    ["03 / Chủ động lựa chọn", "Gia hạn cộng thêm vào thời gian còn lại. Gói PayOS có ngày hết hạn hoặc dùng thử sẽ về Free khi hết hạn; workspace và dữ liệu vẫn được giữ."],
  ] : [
    ["01 / Try it", "Seven days to test your workflow. Connect a source, import recent data and see your KPI dashboard before deciding."],
    ["02 / Continue", `Pay ${monthlyPrice} for 30 days or ${annualPrice} for 365 days. PayOS verifies your transfer before access is extended.`],
    ["03 / Stay in control", "Renewals add to your remaining time. If a dated PayOS plan or trial expires, Free limits apply and your workspace and data remain."],
  ];

  return (
    <div lang={language} className="marketing-polish pricing-frontier">
      <section className="pf-hero"><div className="pf-hero-glow" aria-hidden="true" /><div className="polish-container">
        <MarketingScrollReveal cinematic><p className="polish-eyebrow">MONSTERA CLOUD / {vi ? "BẢNG GIÁ" : "PRICING"}</p><div className="pf-hero-grid"><div><h1>{vi ? "Bắt đầu rõ ràng." : "Start with clarity."}<br /><span>{vi ? "Mở rộng tự tin." : "Grow with certainty."}</span></h1></div><div className="pf-hero-aside"><p>{vi ? "Dữ liệu hiệu suất của nhiều khách hàng trong một quy trình báo cáo rõ ràng. Dùng thử Agency Pro bảy ngày, rồi quyết định có tiếp tục hay không." : "A clear reporting workflow for every client. Try Agency Pro for seven days, then decide whether it earns a place in your stack."}</p><Link className="polish-link" href="#plans">{vi ? "Khám phá các gói" : "Explore the plans"}<ArrowRight size={16} /></Link></div></div></MarketingScrollReveal>
        <MarketingScrollReveal cinematic className="pf-hero-proof"><span><Check size={15} />{vi ? "Không cần thanh toán để bắt đầu" : "No payment required to start"}</span><span><Check size={15} />{vi ? "Không tự động trừ tiền ngân hàng" : "No automatic bank deductions"}</span><span><Check size={15} />{vi ? "Workspace và dữ liệu được giữ lại" : "Your workspace and data remain"}</span></MarketingScrollReveal>
      </div></section>

      <section id="plans" className="pf-plan-section polish-container"><MarketingScrollReveal cinematic className="pf-section-heading"><p className="polish-eyebrow">{vi ? "CHỌN GÓI PHÙ HỢP" : "CHOOSE YOUR PATH"}</p><h2>{vi ? "Một bước thử." : "A simple start."}<br /><span>{vi ? "Một lựa chọn rõ ràng." : "A clear decision."}</span></h2><p>{vi ? "Bắt đầu với một khách hàng thật. Kiểm tra báo cáo và chọn cách tiếp tục phù hợp với agency của bạn." : "Start with one real client. Validate the reporting workflow and choose how to continue."}</p></MarketingScrollReveal>
        <MarketingScrollReveal cinematic className="pf-plan-controls"><BillingCycleSwitch cycle={cycle} onChange={setCycle} language={language} /><div><select aria-label="Pricing language" value={language} onChange={event => setLanguage(event.target.value as PricingLanguage)}><option value="en">English</option><option value="vi">Tiếng Việt</option></select><select aria-label="Pricing currency" value={currency} onChange={event => setCurrency(event.target.value as BillingCurrency)}><option value="VND">VND · VietQR</option><option value="USD">USD · {vi ? "liên hệ" : "contact sales"}</option></select></div></MarketingScrollReveal>
        <MarketingScrollReveal cinematic className="pf-plans"><PlanOptions cycle={cycle} currency={currency} language={language}
          primaryLabel={vi ? (workspaceId ? "Tiếp tục với Agency Pro" : "Dùng thử miễn phí bảy ngày") : workspaceId ? "Continue with Agency Pro" : "Start seven-day free pilot"}
          onSelect={plan => {
            if (plan === "enterprise" || currency === "USD") {
              window.location.href = "mailto:support@monsteracloud.com?subject=Monstera%20Cloud%20plan%20enquiry";
              return;
            }
            if (!workspaceId) { router.push("/register?offer=agency-pro-pilot"); return; }
            setCheckoutOpen(true);
            metaPixelCustom("MC_VietQR_Modal_Opened", { plan, billing_cycle: cycle, amount_vnd: agencyProAmount(cycle) });
          }}
        /></MarketingScrollReveal>
        <p className="pf-plan-fineprint">{vi ? "Kết nối nguồn không phải số tài khoản quảng cáo. Khả năng kết nối phụ thuộc phê duyệt của nền tảng và quyền tài khoản. Phạm vi Enterprise được thống nhất trước khi thanh toán. Mỗi khoản thanh toán áp dụng cho workspace đã chọn." : "Source connections are not individual ad accounts. Connector availability depends on provider approval and your account permissions. Enterprise capacity and support are agreed before purchase. Each payment covers the selected workspace."}</p>
        {currency === "USD" && <p className="pf-usd-note">{vi ? "Thanh toán USD được tư vấn riêng, không qua VietQR. Bạn vẫn có thể " : "USD plans are arranged with sales, not charged through VietQR. You can still "}<Link href="/register?offer=agency-pro-pilot">{vi ? "dùng thử miễn phí" : "start a free pilot"}</Link>.</p>}
      </section>

      <section className="pf-journey"><div className="polish-container"><MarketingScrollReveal cinematic className="pf-journey-heading"><div><p className="polish-eyebrow">{vi ? "TỪ DÙNG THỬ ĐẾN TIẾP TỤC" : "FROM PILOT TO PLAN"}</p><h2>{vi ? "Biết rõ điều gì xảy ra." : "Know what happens next."}</h2></div><ShieldCheck size={72} strokeWidth={.65} /></MarketingScrollReveal><div className="pf-journey-grid">{steps.map(([title, body], index) => <MarketingScrollReveal cinematic delay={index * 75} key={title}><div className="pf-journey-step"><span>0{index + 1}<i /></span><h3>{title}</h3><p>{body}</p></div></MarketingScrollReveal>)}</div></div></section>

      <section className="pf-questions polish-container"><MarketingScrollReveal cinematic><p className="polish-eyebrow">{vi ? "TRƯỚC KHI BẮT ĐẦU" : "BEFORE YOU BEGIN"}</p><h2>{vi ? "Những điều cần biết." : "The useful details."}</h2><p>{vi ? "Chọn gói với đầy đủ thông tin về thanh toán và quyền truy cập." : "A straightforward view of billing and access."}</p></MarketingScrollReveal><div className="pf-question-list"><details><summary>{vi ? "Dùng thử có cần thanh toán không?" : "Do I need to pay to start the pilot?"}<span>+</span></summary><p>{vi ? "Không. Bạn có thể bắt đầu dùng thử Agency Pro bảy ngày mà không cần thanh toán. Không có việc tự động trừ tiền ngân hàng." : "No. You can start the seven-day Agency Pro pilot without payment. There are no automatic bank deductions."}</p></details><details><summary>{vi ? "Gia hạn được tính như thế nào?" : "How does renewal work?"}<span>+</span></summary><p>{vi ? "Thanh toán được PayOS xác minh trước khi gia hạn quyền truy cập. Mỗi lần gia hạn cộng thêm 30 hoặc 365 ngày vào thời gian còn lại." : "PayOS verifies the transfer before access is extended. Each renewal adds 30 or 365 days to your remaining time."}</p></details><details><summary>{vi ? "Nếu gói hết hạn thì sao?" : "What if I do not continue?"}<span>+</span></summary><p>{vi ? "Nếu gói PayOS có ngày hết hạn hoặc thời gian dùng thử kết thúc, giới hạn Free sẽ áp dụng. Workspace và dữ liệu vẫn được giữ lại." : "When a dated PayOS plan or trial expires, Free limits apply. Your workspace and data remain."}</p></details></div></section>

      <section className="pf-bottom"><div className="polish-container"><MarketingScrollReveal cinematic className="pf-bottom-grid"><div><p className="polish-eyebrow">{vi ? "BẠN GIỮ QUYỀN KIỂM SOÁT" : "YOU STAY IN CONTROL"}</p><h2>{vi ? "Bắt đầu với một khách hàng thật." : "Start with one real client."}</h2><p>{vi ? "Bạn đang dùng gói khác? Quản lý workspace trong cài đặt thanh toán. Chuyển gói trả phí cũ và thỏa thuận riêng cần được xem xét trước. Thanh toán tự phục vụ không tự động tính tín dụng theo thời gian còn lại hoặc hoàn tiền." : "Already on another plan? Manage your workspace in billing settings. Legacy paid-tier changes and custom arrangements need a billing review. Self-serve checkout does not automatically apply prorated credits or refunds."}</p><div className="pf-bottom-links"><Link href="/settings?tab=billing" className="polish-link">{vi ? "Quản lý thanh toán" : "Manage billing"}<ArrowRight size={15} /></Link><a href="mailto:support@monsteracloud.com" className="polish-link">{vi ? "Trao đổi với nhà sáng lập" : "Talk to the founder"}<ArrowRight size={15} /></a></div></div><div className="pf-bottom-cta"><span>07</span><p>{vi ? "ngày để kiểm chứng giá trị" : "days to prove the value"}</p><Link href="/register?offer=agency-pro-pilot" className="polish-button">{vi ? "Dùng thử Agency Pro" : "Start your Agency Pro pilot"}<ArrowRight size={16} /></Link></div></MarketingScrollReveal></div></section>
      <VietQrModal isOpen={checkoutOpen} onClose={() => setCheckoutOpen(false)} planName="professional" planDisplayName="Agency Pro" amountVnd={agencyProAmount(cycle)} billingCycle={cycle} workspaceId={workspaceId} />
    </div>
  );
}

export default function PricingPage() {
  return <Suspense fallback={<div className="p-12 text-center text-sm text-ink-mute">Loading plans…</div>}><PricingPageContent /></Suspense>;
}
