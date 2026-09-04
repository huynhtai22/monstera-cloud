"use client";

import Link from "next/link";
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
    <div lang={language} className="mx-auto max-w-4xl px-5 pb-24 pt-16 sm:px-8 sm:pt-24">
      <header className="mx-auto mb-10 max-w-2xl text-center">
        <p className="mb-4 text-xs font-medium text-ink-mute">MONSTERA CLOUD / {vi ? "BẢNG GIÁ" : "PRICING"}</p>
        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          {vi ? "Dữ liệu rõ ràng." : "One clear view."}<br />
          <span className="text-ink-mute">{vi ? "Chi phí dễ kiểm soát." : "One predictable plan."}</span>
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-ink-mute">
          {vi ? "Tập trung dữ liệu hiệu suất của agency trong một workspace. Bắt đầu dùng thử Agency Pro miễn phí bảy ngày, rồi quyết định khi nào tiếp tục." : "Bring your agency’s performance data into a shared workspace. Start with a seven-day free Agency Pro pilot, then choose when to continue."}
        </p>
        <p className="mt-3 text-xs text-ink-mute">{vi ? "Không cần thanh toán để bắt đầu. Không tự động trừ tiền ngân hàng." : "No payment required to start. No automatic bank deductions."}</p>
      </header>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <BillingCycleSwitch cycle={cycle} onChange={setCycle} language={language} />
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Pricing language" value={language} onChange={event => setLanguage(event.target.value as PricingLanguage)} className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-ink">
            <option value="en">English</option><option value="vi">Tiếng Việt</option>
          </select>
          <select aria-label="Pricing currency" value={currency} onChange={event => setCurrency(event.target.value as BillingCurrency)} className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-ink">
            <option value="VND">VND · VietQR</option><option value="USD">USD · {vi ? "liên hệ" : "contact sales"}</option>
          </select>
        </div>
      </div>
      <PlanOptions cycle={cycle} currency={currency} language={language}
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
      />
      <p className="mt-4 text-xs leading-5 text-ink-mute">
        {vi ? "Kết nối nguồn không phải số tài khoản quảng cáo. Khả năng kết nối phụ thuộc phê duyệt của nền tảng và quyền tài khoản. Phạm vi Enterprise được thống nhất trước khi thanh toán. Mỗi khoản thanh toán áp dụng cho workspace đã chọn." : "Source connections are not individual ad accounts. Connector availability depends on provider approval and your account permissions. Enterprise capacity and support are agreed before purchase. Each payment covers the selected workspace."}
      </p>
      {currency === "USD" && <p className="mt-3 text-sm text-ink-mute">
        {vi ? "Thanh toán USD được tư vấn riêng, không qua VietQR. Bạn vẫn có thể " : "USD plans are arranged with sales, not charged through VietQR. You can still "}
        <Link href="/register?offer=agency-pro-pilot" className="text-ink underline underline-offset-4">{vi ? "dùng thử miễn phí" : "start a free pilot"}</Link>.
      </p>}
      <section aria-labelledby="payment-explained" className="mt-12 border-t border-line pt-8">
        <h2 id="payment-explained" className="text-lg font-semibold text-ink">{vi ? "Điều gì xảy ra khi bạn chọn gói?" : "What happens when you choose a plan?"}</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {steps.map(([title, body]) => <div key={title}><h3 className="text-sm font-medium text-ink">{title}</h3><p className="mt-2 text-xs leading-6 text-ink-mute">{body}</p></div>)}
        </div>
      </section>
      <section className="mt-10 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-sm font-medium text-ink">{vi ? "Bạn đang sử dụng gói khác?" : "Already on a different plan?"}</h2>
        <p className="mt-2 text-xs leading-6 text-ink-mute">{vi ? "Quản lý workspace trong cài đặt thanh toán. Chuyển gói trả phí cũ và thỏa thuận riêng cần được xem xét trước. Thanh toán tự phục vụ không tự động tính tín dụng theo thời gian còn lại, hoàn tiền hay trừ tiền ngân hàng." : "Manage your workspace in billing settings. Legacy paid-tier changes and custom arrangements need a billing review. There are no automatic prorated credits, refunds or bank deductions in self-serve checkout."}</p>
        <div className="mt-4 flex flex-wrap gap-5 text-xs">
          <Link className="text-ink underline underline-offset-4" href="/settings?tab=billing">{vi ? "Quản lý thanh toán" : "Manage billing"}</Link>
          <a className="text-ink underline underline-offset-4" href="mailto:support@monsteracloud.com">{vi ? "Trao đổi với nhà sáng lập" : "Talk to the founder"}</a>
        </div>
      </section>
      <VietQrModal isOpen={checkoutOpen} onClose={() => setCheckoutOpen(false)} planName="professional" planDisplayName="Agency Pro" amountVnd={agencyProAmount(cycle)} billingCycle={cycle} workspaceId={workspaceId} />
    </div>
  );
}

export default function PricingPage() {
  return <Suspense fallback={<div className="p-12 text-center text-sm text-ink-mute">Loading plans…</div>}><PricingPageContent /></Suspense>;
}
