"use client";

import React, { useState } from "react";
import { Check, Copy, QrCode, X, Building2, Sparkles } from "lucide-react";

interface VietQrModalProps {
    isOpen: boolean;
    onClose: () => void;
    planName: string;
    planDisplayName: string;
    amountVnd: number;
    billingCycle: "monthly" | "annual";
    userEmail?: string;
}

export function VietQrModal({
    isOpen,
    onClose,
    planName,
    planDisplayName,
    amountVnd,
    billingCycle,
    userEmail = "",
}: VietQrModalProps) {
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [notified, setNotified] = useState(false);

    if (!isOpen) return null;

    // Bank Information (Techcombank / Vietcombank configurable)
    const BANK_ID = "TCB"; // Techcombank (or VCB, MB)
    const BANK_NAME = "Techcombank (Ngân hàng Kỹ Thương)";
    const ACCOUNT_NO = "19036888888888"; // Placeholder account number - easily customized
    const ACCOUNT_NAME = "MONSTERA CLOUD VIETNAM";

    const cleanEmail = userEmail ? userEmail.split("@")[0].slice(0, 10).toUpperCase() : "AGENCY";
    const transferMemo = `MC ${planName.toUpperCase()} ${cleanEmail}`.trim();

    // VietQR API image URL format
    const qrUrl = `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT_NO}-compact2.png?amount=${amountVnd}&addInfo=${encodeURIComponent(
        transferMemo
    )}&accountName=${encodeURIComponent(ACCOUNT_NAME)}`;

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                            <QrCode className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-base">
                                Chuyển khoản VietQR (Napas 24/7)
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-semibold">
                                    Kích hoạt tức thì
                                </span>
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Gói {planDisplayName} ({billingCycle === "annual" ? "Thanh toán 1 năm" : "Thanh toán 1 tháng"})
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* QR Code Display */}
                    <div className="flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                        <img
                            src={qrUrl}
                            alt="VietQR Payment Code"
                            className="w-56 h-auto rounded-lg shadow-sm bg-white p-2"
                        />
                        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 text-center flex items-center gap-1.5 font-medium">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                            Quét mã bằng app ngân hàng (Vietcombank, Techcombank, MB, Momo, v.v.)
                        </p>
                    </div>

                    {/* Transfer Details Form */}
                    <div className="space-y-3 text-sm">
                        {/* Bank & Account */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Ngân hàng</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{BANK_NAME}</span>
                            </div>
                            <Building2 className="w-5 h-5 text-slate-400" />
                        </div>

                        {/* Account Number */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Số tài khoản</span>
                                <span className="font-mono font-bold text-slate-900 dark:text-white text-base tracking-wide">
                                    {ACCOUNT_NO}
                                </span>
                            </div>
                            <button
                                onClick={() => copyToClipboard(ACCOUNT_NO, "account")}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 shadow-sm"
                            >
                                {copiedField === "account" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                {copiedField === "account" ? "Đã chép" : "Sao chép"}
                            </button>
                        </div>

                        {/* Amount */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Số tiền chính xác</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400 text-base">
                                    {amountVnd.toLocaleString("vi-VN")} đ
                                </span>
                            </div>
                            <button
                                onClick={() => copyToClipboard(String(amountVnd), "amount")}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 shadow-sm"
                            >
                                {copiedField === "amount" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                {copiedField === "amount" ? "Đã chép" : "Sao chép"}
                            </button>
                        </div>

                        {/* Transfer Content / Memo */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40">
                            <div>
                                <span className="text-xs text-emerald-700 dark:text-emerald-400 block font-medium">
                                    Nội dung chuyển khoản (Bắt buộc ghi đúng)
                                </span>
                                <span className="font-mono font-bold text-emerald-950 dark:text-emerald-200 text-sm tracking-wide">
                                    {transferMemo}
                                </span>
                            </div>
                            <button
                                onClick={() => copyToClipboard(transferMemo, "memo")}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                            >
                                {copiedField === "memo" ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                                {copiedField === "memo" ? "Đã chép" : "Sao chép"}
                            </button>
                        </div>
                    </div>

                    {/* Action Confirmation Button */}
                    <div className="pt-2">
                        {notified ? (
                            <div className="p-3 text-center rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-sm font-semibold border border-emerald-300 dark:border-emerald-800">
                                ✅ Cảm ơn bạn! Hệ thống đang kiểm tra giao dịch và sẽ kích hoạt tài khoản trong vòng 5–10 phút. Hotline hỗ trợ: 090.xxx.xxxx (Zalo).
                            </div>
                        ) : (
                            <button
                                onClick={() => setNotified(true)}
                                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
                            >
                                <Check className="w-4 h-4" />
                                Tôi đã hoàn tất chuyển khoản
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
