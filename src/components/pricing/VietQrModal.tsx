"use client";

import { useEffect, useState } from "react";
import { Loader2, QrCode, X } from "lucide-react";

interface VietQrModalProps {
    isOpen: boolean;
    onClose: () => void;
    planName: string;
    planDisplayName: string;
    amountVnd: number;
    billingCycle: "monthly" | "annual";
    userEmail?: string;
}

/** Kept under its legacy filename to avoid changing the pricing integration. */
export function VietQrModal({ isOpen, onClose, planName, planDisplayName, billingCycle }: VietQrModalProps) {
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setError(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch("/api/payments/vietqr/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ plan: planName, billingCycle }),
                });
                const data = await response.json().catch(() => ({}));
                const checkoutUrl = data?.order?.checkoutUrl;
                if (!response.ok || typeof checkoutUrl !== "string") throw new Error("PayOS checkout unavailable");
                if (!cancelled) window.location.assign(checkoutUrl);
            } catch {
                if (!cancelled) setError("Không thể kết nối PayOS. Vui lòng thử lại sau.");
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, planName, billingCycle]);

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900">
                <button onClick={onClose} aria-label="Đóng" className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                    <X className="h-5 w-5" />
                </button>
                <div className="mx-auto mb-4 w-fit rounded-xl bg-emerald-100 p-3 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"><QrCode className="h-6 w-6" /></div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Thanh toán PayOS</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Gói {planDisplayName} ({billingCycle === "annual" ? "1 năm" : "1 tháng"})</p>
                {error ? (
                    <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
                ) : (
                    <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /> Đang chuyển đến PayOS…</div>
                )}
            </div>
        </div>
    );
}
