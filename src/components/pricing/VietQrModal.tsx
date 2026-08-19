"use client";

import React, { useState, useEffect } from "react";
import { Check, Copy, QrCode, X, Building2, Sparkles, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { type PlanName } from "@/lib/plan-config";

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
    const [loadingOrder, setLoadingOrder] = useState(false);
    const [orderCode, setOrderCode] = useState<number | null>(null);
    const [memo, setMemo] = useState<string>("");
    const [qrUrl, setQrUrl] = useState<string>("");
    const [isPaid, setIsPaid] = useState(false);
    const [notified, setNotified] = useState(false);

    const [bankName, setBankName] = useState<string>("Techcombank (Ngân hàng Kỹ Thương)");
    const [accountNo, setAccountNo] = useState<string>("19036348292019");
    const [accountName, setAccountName] = useState<string>("HUYNH CAM TAI");

    // 1. Create dynamic payment order on open
    useEffect(() => {
        if (!isOpen) {
            setIsPaid(false);
            setOrderCode(null);
            setNotified(false);
            return;
        }

        setLoadingOrder(true);
        fetch("/api/payments/vietqr/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                plan: planName,
                billingCycle,
                userEmail,
            }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.order) {
                    setOrderCode(data.order.orderCode);
                    setMemo(data.order.memo);
                    setQrUrl(data.order.qrUrl);
                }
            })
            .catch((err) => console.error("Error creating VietQR order", err))
            .finally(() => setLoadingOrder(false));
    }, [isOpen, planName, billingCycle, userEmail]);

    // 2. Poll for payment status every 3 seconds
    useEffect(() => {
        if (!isOpen || !orderCode || isPaid) return;

        const interval = setInterval(() => {
            fetch(`/api/payments/vietqr/${orderCode}/status`)
                .then((res) => res.json())
                .then((data) => {
                    if (data.status === "PAID") {
                        setIsPaid(true);
                    }
                })
                .catch(() => {});
        }, 3000);

        return () => clearInterval(interval);
    }, [isOpen, orderCode, isPaid]);

    if (!isOpen) return null;

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                            <QrCode className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-base">
                                Cổng thanh toán VietQR (Napas 24/7)
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-bold">
                                    Tự động 24/7
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
                    {/* Success Screen */}
                    {isPaid ? (
                        <div className="py-8 text-center space-y-4 animate-in zoom-in-95 duration-200">
                            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/80 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400 shadow-lg">
                                <CheckCircle2 className="w-10 h-10" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="text-2xl font-extrabold text-slate-900 dark:text-white">
                                    Thanh toán thành công!
                                </h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                                    Tài khoản và workspace của bạn đã được nâng cấp lên gói <strong>{planDisplayName}</strong>.
                                </p>
                            </div>
                            <div className="pt-4">
                                <Link
                                    href="/console"
                                    onClick={onClose}
                                    className="inline-flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-all"
                                >
                                    <span>Truy cập Console ngay</span>
                                    <ArrowRight className="w-4 h-4" />
                                </Link>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* QR Code Display with Listening Indicator */}
                            <div className="flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                                {loadingOrder || !qrUrl ? (
                                    <div className="w-56 h-56 flex flex-col items-center justify-center gap-2 text-slate-400">
                                        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                                        <span className="text-xs">Đang tạo mã VietQR...</span>
                                    </div>
                                ) : (
                                    <img
                                        src={qrUrl}
                                        alt="VietQR Payment Code"
                                        className="w-56 h-auto rounded-xl shadow-sm bg-white p-2"
                                    />
                                )}
                                <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-900/60">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    <span>Đang lắng nghe chuyển khoản từ ngân hàng...</span>
                                </div>
                            </div>

                            {/* Transfer Details Form */}
                            <div className="space-y-2.5 text-xs">
                                {/* Bank & Account */}
                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <div>
                                        <span className="text-slate-400 block font-medium">Ngân hàng thụ hưởng</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200">{bankName}</span>
                                    </div>
                                    <Building2 className="w-5 h-5 text-slate-400" />
                                </div>

                                {/* Account Holder Name */}
                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <div>
                                        <span className="text-slate-400 block font-medium">Chủ tài khoản</span>
                                        <span className="font-bold text-slate-900 dark:text-white uppercase tracking-wide">
                                            {accountName}
                                        </span>
                                    </div>
                                </div>

                                {/* Account Number */}
                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <div>
                                        <span className="text-slate-400 block font-medium">Số tài khoản</span>
                                        <span className="font-mono font-bold text-slate-900 dark:text-white text-sm tracking-wide">
                                            {accountNo}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(accountNo, "account")}
                                        className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 shadow-2xs"
                                    >
                                        {copiedField === "account" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                        {copiedField === "account" ? "Đã chép" : "Sao chép"}
                                    </button>
                                </div>

                                {/* Amount */}
                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <div>
                                        <span className="text-slate-400 block font-medium">Số tiền chính xác</span>
                                        <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                                            {amountVnd.toLocaleString("vi-VN")} đ
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(String(amountVnd), "amount")}
                                        className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 shadow-2xs"
                                    >
                                        {copiedField === "amount" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                        {copiedField === "amount" ? "Đã chép" : "Sao chép"}
                                    </button>
                                </div>

                                {/* Transfer Content / Memo with specific order code */}
                                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/60">
                                    <div>
                                        <span className="text-emerald-700 dark:text-emerald-400 block font-bold">
                                            Nội dung chuyển khoản (Bắt buộc)
                                        </span>
                                        <span className="font-mono font-extrabold text-emerald-950 dark:text-emerald-200 text-sm tracking-wider">
                                            {memo || `MC${orderCode || "..."}`}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(memo || `MC${orderCode}`, "memo")}
                                        className="flex items-center gap-1.5 px-3 py-1.5 font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs"
                                    >
                                        {copiedField === "memo" ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                                        {copiedField === "memo" ? "Đã chép" : "Sao chép"}
                                    </button>
                                </div>
                            </div>

                            {/* Manual Notification / Fallback button */}
                            <div className="pt-1">
                                {notified ? (
                                    <div className="p-3 text-center rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold border border-emerald-300 dark:border-emerald-800">
                                        ✅ Cảm ơn bạn! Hệ thống đang đối soát và sẽ kích hoạt ngay khi nhận được biến động số dư. Hotline Zalo: 090.xxx.xxxx
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setNotified(true)}
                                        className="w-full py-3 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
                                    >
                                        <Check className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
                                        <span>Tôi đã hoàn tất chuyển khoản</span>
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
