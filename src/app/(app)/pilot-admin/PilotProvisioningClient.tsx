"use client";

import { FormEvent, useState } from "react";
import { Check, Copy, Loader2, QrCode, Sparkles, Send, Building2 } from "lucide-react";
import { PLAN_PRICING, type PlanName } from "@/lib/plan-config";

const providers = [
    ["meta_ads", "Meta Ads"],
    ["google_ads", "Google Ads"],
    ["tiktok_business", "TikTok Ads"],
    ["shopee", "Shopee"],
] as const;

export function PilotProvisioningClient() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [invitationUrl, setInvitationUrl] = useState("");

    // BD Sales VietQR Generator State
    const [bdPlan, setBdPlan] = useState<PlanName>("professional");
    const [bdDurationMonths, setBdDurationMonths] = useState(12); // Default 1 year
    const [bdAgencyName, setBdAgencyName] = useState("");
    const [bdDiscountPercent, setBdDiscountPercent] = useState(0);
    const [copiedQr, setCopiedQr] = useState(false);

    // Calculate BD Custom Amount
    const baseMonthlyPrice = bdDurationMonths >= 12
        ? PLAN_PRICING[bdPlan].vndAnnualMonthly
        : PLAN_PRICING[bdPlan].vndMonthly;

    const rawTotal = baseMonthlyPrice * bdDurationMonths;
    const finalTotal = Math.round(rawTotal * (1 - bdDiscountPercent / 100));

    const BANK_ID = "TCB";
    const ACCOUNT_NO = "19036888888888";
    const ACCOUNT_NAME = "MONSTERA CLOUD VIETNAM";
    const memo = `MC ${bdPlan.toUpperCase()} ${bdAgencyName ? bdAgencyName.trim().toUpperCase().replace(/\s+/g, "") : "AGENCY"}`.slice(0, 25);

    const bdQrUrl = `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT_NO}-compact2.png?amount=${finalTotal}&addInfo=${encodeURIComponent(
        memo
    )}&accountName=${encodeURIComponent(ACCOUNT_NAME)}`;

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError("");
        setInvitationUrl("");
        const form = new FormData(event.currentTarget);
        const enabledProviders = providers.map(([id]) => id).filter((id) => form.get(id) === "on");
        try {
            const response = await fetch("/api/internal/pilot/workspaces", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agencyName: form.get("agencyName"),
                    agencySlug: form.get("agencySlug"),
                    email: form.get("email"),
                    plan: form.get("plan"),
                    enabledProviders,
                }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || "Provisioning failed");
            setInvitationUrl(body.invitationUrl);
            event.currentTarget.reset();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Provisioning failed");
        } finally {
            setBusy(false);
        }
    }

    const copySalesPitch = () => {
        const pitch = `Chào bạn, Monstera Cloud gửi bạn thông tin kích hoạt gói ${bdPlan.toUpperCase()} (${bdDurationMonths} tháng):\n- Số tiền: ${finalTotal.toLocaleString("vi-VN")} đ\n- Ngân hàng: Techcombank (19036888888888)\n- Tên TK: MONSTERA CLOUD VIETNAM\n- Nội dung CK: ${memo}\n- Link đăng nhập & kết nối: https://monsteracloud.com/console`;
        navigator.clipboard.writeText(pitch);
        setCopiedQr(true);
        setTimeout(() => setCopiedQr(false), 2500);
    };

    return (
        <main className="mx-auto max-w-5xl p-6 sm:p-10 space-y-10">
            {/* Header */}
            <div>
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-700">Internal Operations &amp; Sales Hub</p>
                <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">Business Development &amp; Pilot Control</h1>
                <p className="mt-2 text-slate-600 dark:text-slate-300">
                    Tạo lời mời Pilot 14 ngày cho Agency hoặc tạo mã VietQR thanh toán nhanh để chốt đơn khách hàng Việt Nam.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Tool 1: 14-Day Pilot Invitation Generator */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="p-2 rounded-lg bg-cyan-100 text-cyan-700 font-bold text-xs">Option 1</span>
                            <h2 className="font-bold text-lg text-slate-900 dark:text-white">Tạo link mời Pilot Agency</h2>
                        </div>
                        <p className="text-xs text-slate-500 mb-6">
                            Tạo link đăng ký đặc quyền cho Agency với đầy đủ các kênh Meta Ads, TikTok Ads, Shopee và Google Ads.
                        </p>

                        <form onSubmit={submit} className="grid gap-4">
                            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Tên Agency / Khách hàng
                                <input name="agencyName" required placeholder="Ví dụ: PMAX Agency" className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm" />
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Workspace Slug (viết liền không dấu)
                                <input name="agencySlug" required pattern="[a-z0-9-]{3,}" placeholder="pmax-agency" className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm" />
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Email Agency Owner
                                <input name="email" required type="email" placeholder="owner@agency.vn" className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm" />
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Gói dịch vụ
                                <select name="plan" defaultValue="pilot" className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm">
                                    <option value="pilot">Pilot (14 ngày dùng thử)</option>
                                    <option value="starter">Starter</option>
                                    <option value="professional">Professional</option>
                                    <option value="enterprise">Enterprise</option>
                                </select>
                            </label>
                            <fieldset>
                                <legend className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Kênh quảng cáo kích hoạt</legend>
                                <div className="grid grid-cols-2 gap-2">
                                    {providers.map(([id, label]) => (
                                        <label key={id} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                            <input name={id} type="checkbox" defaultChecked /> {label}
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                            {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700 font-semibold">{error}</p> : null}
                            <button disabled={busy} className="mt-2 flex items-center justify-center rounded-xl bg-cyan-700 px-4 py-2.5 font-bold text-sm text-white hover:bg-cyan-800 disabled:opacity-60 transition-all">
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tạo link mời Agency"}
                            </button>
                        </form>
                    </div>

                    {invitationUrl ? (
                        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                            <div className="flex items-center gap-2 font-semibold text-xs text-emerald-800">
                                <Check className="h-4 w-4 text-emerald-600" /> Link mời đã tạo thành công
                            </div>
                            <div className="mt-2 flex gap-2">
                                <input readOnly value={invitationUrl} className="min-w-0 flex-1 rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs font-mono" />
                                <button type="button" onClick={() => navigator.clipboard.writeText(invitationUrl)} aria-label="Copy invitation URL" className="rounded border border-emerald-300 bg-white px-3 py-1.5 hover:bg-emerald-100">
                                    <Copy className="h-4 w-4 text-emerald-700" />
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Tool 2: Instant VietQR Generator for BD Sales */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="p-2 rounded-lg bg-emerald-100 text-emerald-700 font-bold text-xs">Option 2 (BD Tool)</span>
                            <h2 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                                <QrCode className="w-5 h-5 text-emerald-600" />
                                Tạo mã VietQR chốt sale
                            </h2>
                        </div>
                        <p className="text-xs text-slate-500 mb-6">
                            Tạo nhanh mã QR chuyển khoản với số tiền và nội dung tự động để gửi qua Zalo/Telegram cho khách hàng.
                        </p>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                                    Tên khách hàng / Agency
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ví dụ: Novaon / Dentsu"
                                    value={bdAgencyName}
                                    onChange={(e) => setBdAgencyName(e.target.value)}
                                    className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                                        Gói dịch vụ
                                    </label>
                                    <select
                                        value={bdPlan}
                                        onChange={(e) => setBdPlan(e.target.value as PlanName)}
                                        className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm"
                                    >
                                        <option value="starter">Starter (490k/tháng)</option>
                                        <option value="professional">Agency Pro (1.190k/tháng)</option>
                                        <option value="enterprise">Enterprise (2.490k/tháng)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                                        Thời hạn
                                    </label>
                                    <select
                                        value={bdDurationMonths}
                                        onChange={(e) => setBdDurationMonths(Number(e.target.value))}
                                        className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm"
                                    >
                                        <option value={1}>1 tháng</option>
                                        <option value={3}>3 tháng</option>
                                        <option value={6}>6 tháng</option>
                                        <option value={12}>12 tháng (Giá ưu đãi năm)</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                                    Chiết khấu thêm (%)
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    value={bdDiscountPercent}
                                    onChange={(e) => setBdDiscountPercent(Number(e.target.value))}
                                    className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm"
                                />
                            </div>

                            {/* Generated QR Summary */}
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-4">
                                <img src={bdQrUrl} alt="VietQR" className="w-24 h-24 rounded-lg bg-white p-1 border shadow-xs" />
                                <div className="space-y-1 text-xs">
                                    <p className="font-bold text-emerald-600 text-sm">{finalTotal.toLocaleString("vi-VN")} đ</p>
                                    <p className="text-slate-500 font-mono">Nội dung: {memo}</p>
                                    <p className="text-slate-400">Techcombank · 19036888888888</p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={copySalesPitch}
                                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
                            >
                                {copiedQr ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                                {copiedQr ? "Đã chép nội dung chốt sale!" : "Sao chép thông điệp gửi khách"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
