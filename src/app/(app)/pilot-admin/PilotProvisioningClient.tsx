"use client";

import { FormEvent, useState, useEffect } from "react";
import { Check, Copy, Loader2, QrCode, Sparkles, Send, Building2, CheckCircle2, RefreshCw } from "lucide-react";
import { PLAN_PRICING, type PlanName } from "@/lib/plan-config";

const providers = [
    ["meta_ads", "Meta Ads"],
    ["google_ads", "Google Ads"],
    ["tiktok_business", "TikTok Ads"],
    ["shopee", "Shopee"],
] as const;

interface RecentOrder {
    orderCode: number;
    plan: string;
    billingCycle: string;
    amount: number;
    memo: string;
    status: string;
    userEmail?: string;
    createdAt: number;
}

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

    // Recent Orders State for In-House Activation
    const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [approvingCode, setApprovingCode] = useState<number | null>(null);

    // Calculate BD Custom Amount
    const baseMonthlyPrice = bdDurationMonths >= 12
        ? PLAN_PRICING[bdPlan].vndAnnualMonthly
        : PLAN_PRICING[bdPlan].vndMonthly;

    const rawTotal = baseMonthlyPrice * bdDurationMonths;
    const finalTotal = Math.round(rawTotal * (1 - bdDiscountPercent / 100));

    const BANK_ID = "TCB";
    const ACCOUNT_NO = "19036348292019";
    const ACCOUNT_NAME = "HUYNH CAM TAI";
    const memo = `MC ${bdPlan.toUpperCase()} ${bdAgencyName ? bdAgencyName.trim().toUpperCase().replace(/\s+/g, "") : "AGENCY"}`.slice(0, 25);

    const bdQrUrl = `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT_NO}-compact2.png?amount=${finalTotal}&addInfo=${encodeURIComponent(
        memo
    )}&accountName=${encodeURIComponent(ACCOUNT_NAME)}`;

    const loadRecentOrders = () => {
        setLoadingOrders(true);
        fetch("/api/payments/vietqr/manual-confirm")
            .then((r) => r.json())
            .then((d) => {
                if (d.orders) setRecentOrders(d.orders);
            })
            .catch(() => {})
            .finally(() => setLoadingOrders(false));
    };

    useEffect(() => {
        loadRecentOrders();
    }, []);

    const approveOrder = async (orderCode: number) => {
        setApprovingCode(orderCode);
        try {
            const res = await fetch("/api/payments/vietqr/manual-confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderCode }),
            });
            if (res.ok) {
                loadRecentOrders();
            }
        } catch (err) {
            console.error("Failed to approve order", err);
        } finally {
            setApprovingCode(null);
        }
    };

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
        const pitch = `Chào bạn, Monstera Cloud gửi bạn thông tin kích hoạt gói ${bdPlan.toUpperCase()} (${bdDurationMonths} tháng):\n- Số tiền: ${finalTotal.toLocaleString("vi-VN")} đ\n- Ngân hàng: Techcombank (19036348292019)\n- Tên TK: HUYNH CAM TAI\n- Nội dung CK: ${memo}\n- Link đăng nhập & kết nối: https://monsteracloud.com/console`;
        navigator.clipboard.writeText(pitch);
        setCopiedQr(true);
        setTimeout(() => setCopiedQr(false), 2500);
    };

    return (
        <main className="mx-auto max-w-6xl p-6 sm:p-10 space-y-10">
            {/* Header */}
            <div>
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-700">Internal Operations &amp; Sales Hub</p>
                <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">Business Development &amp; Pilot Control</h1>
                <p className="mt-2 text-slate-600 dark:text-slate-300">
                    Tạo lời mời Pilot 14 ngày cho Agency, tạo mã VietQR chốt đơn, hoặc duyệt kích hoạt tài khoản thanh toán chuyển khoản thủ công.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Tool 1: 14-Day Pilot Invitation Generator */}
                <div className="rounded-3xl border border-slate-200 bg-white p-6 md:p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="p-2 rounded-xl bg-cyan-100 text-cyan-700 font-bold text-xs">Option 1</span>
                            <h2 className="font-bold text-lg text-slate-900 dark:text-white">Tạo link mời Pilot Agency</h2>
                        </div>
                        <p className="text-xs text-slate-500 mb-6">
                            Tạo link đăng ký đặc quyền cho Agency với đầy đủ các kênh Meta Ads, TikTok Ads, Shopee và Google Ads.
                        </p>

                        <form onSubmit={submit} className="grid gap-4">
                            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Tên Agency / Khách hàng
                                <input name="agencyName" required placeholder="Ví dụ: PMAX Agency" className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm" />
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Workspace Slug (viết liền không dấu)
                                <input name="agencySlug" required pattern="[a-z0-9-]{3,}" placeholder="pmax-agency" className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm" />
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Email Agency Owner
                                <input name="email" required type="email" placeholder="owner@agency.vn" className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm" />
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Gói dịch vụ
                                <select name="plan" defaultValue="pilot" className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm">
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
                            <button disabled={busy} className="mt-2 flex items-center justify-center rounded-xl bg-cyan-700 px-4 py-3 font-bold text-sm text-white hover:bg-cyan-800 disabled:opacity-60 transition-all">
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tạo link mời Agency"}
                            </button>
                        </form>
                    </div>

                    {invitationUrl ? (
                        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                            <div className="flex items-center gap-2 font-semibold text-xs text-emerald-800">
                                <Check className="h-4 w-4 text-emerald-600" /> Link mời đã tạo thành công
                            </div>
                            <div className="mt-2 flex gap-2">
                                <input readOnly value={invitationUrl} className="min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-mono" />
                                <button type="button" onClick={() => navigator.clipboard.writeText(invitationUrl)} aria-label="Copy invitation URL" className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 hover:bg-emerald-100">
                                    <Copy className="h-4 w-4 text-emerald-700" />
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Tool 2: Instant VietQR Generator for BD Sales */}
                <div className="rounded-3xl border border-slate-200 bg-white p-6 md:p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="p-2 rounded-xl bg-emerald-100 text-emerald-700 font-bold text-xs">Option 2 (BD Tool)</span>
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
                                    className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm"
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
                                        className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm"
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
                                        className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm"
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
                                    className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm"
                                />
                            </div>

                            {/* Generated QR Summary */}
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-4">
                                <img src={bdQrUrl} alt="VietQR" className="w-24 h-24 rounded-xl bg-white p-1 border shadow-xs" />
                                <div className="space-y-1 text-xs">
                                    <p className="font-bold text-emerald-600 text-sm">{finalTotal.toLocaleString("vi-VN")} đ</p>
                                    <p className="text-slate-500 font-mono">Nội dung: {memo}</p>
                                    <p className="text-slate-400 font-medium">Techcombank · 19036348292019</p>
                                    <p className="text-slate-400 font-bold uppercase">HUYNH CAM TAI</p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={copySalesPitch}
                                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
                            >
                                {copiedQr ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                                {copiedQr ? "Đã chép nội dung chốt sale!" : "Sao chép thông điệp gửi khách"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tool 3: Recent VietQR Orders & 1-Click Activation */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 md:p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                            <span>Giao dịch VietQR gần đây &amp; Kích hoạt 1-Click</span>
                        </h3>
                        <p className="text-xs text-slate-500">
                            Danh sách các mã đơn hàng khách hàng vừa mở QR. Bấm &quot;Duyệt kích hoạt&quot; khi nhận được tiền trong tài khoản.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={loadRecentOrders}
                        className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingOrders ? "animate-spin" : ""}`} />
                    </button>
                </div>

                {recentOrders.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                        Chưa có giao dịch QR nào được tạo gần đây.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold">
                                    <th className="py-2.5 px-3">Mã Đơn</th>
                                    <th className="py-2.5 px-3">Gói</th>
                                    <th className="py-2.5 px-3">Số tiền</th>
                                    <th className="py-2.5 px-3">Nội dung CK</th>
                                    <th className="py-2.5 px-3">Trạng thái</th>
                                    <th className="py-2.5 px-3 text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                                {recentOrders.map((ord) => (
                                    <tr key={ord.orderCode} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                        <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white">#{ord.orderCode}</td>
                                        <td className="py-3 px-3 uppercase font-semibold text-cyan-600">{ord.plan}</td>
                                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                                            {ord.amount.toLocaleString("vi-VN")} đ
                                        </td>
                                        <td className="py-3 px-3 font-mono font-bold text-emerald-600">{ord.memo}</td>
                                        <td className="py-3 px-3">
                                            <span
                                                className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                                    ord.status === "PAID"
                                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                                        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                                }`}
                                            >
                                                {ord.status}
                                            </span>
                                        </td>
                                        <td className="py-3 px-3 text-right">
                                            {ord.status === "PAID" ? (
                                                <span className="text-emerald-600 font-semibold flex items-center justify-end gap-1 text-[11px]">
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> Đã duyệt
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={approvingCode === ord.orderCode}
                                                    onClick={() => approveOrder(ord.orderCode)}
                                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-2xs transition-all disabled:opacity-50"
                                                >
                                                    {approvingCode === ord.orderCode ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                        "Kích hoạt (1-Click)"
                                                    )}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </main>
    );
}
