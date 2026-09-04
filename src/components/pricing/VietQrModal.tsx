"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, LockKeyhole, QrCode, ShieldCheck, X } from "lucide-react";

interface VietQrModalProps {
    isOpen: boolean;
    onClose: () => void;
    planName: string;
    planDisplayName: string;
    amountVnd: number;
    billingCycle: "monthly" | "annual";
    workspaceId?: string;
    userEmail?: string;
}

type CheckoutOrder = {
    orderCode: number;
    amount: number;
    memo: string;
    qrCode?: string;
    accountNo?: string;
    accountName?: string;
    checkoutUrl?: string;
};

function CopyValue({ value, label }: { value: string; label: string }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            // Manual selection remains available if a browser denies clipboard access.
        }
    };

    return (
        <button onClick={copy} className="group flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.06]" aria-label={`Copy ${label}`}>
            <span className="min-w-0">
                <span className="block text-[11px] text-neutral-500">{label}</span>
                <span className="block truncate font-mono text-sm text-neutral-100">{value}</span>
            </span>
            <span className="shrink-0 text-neutral-200">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4 opacity-70 group-hover:opacity-100" />}</span>
        </button>
    );
}

/** Kept under its legacy filename to avoid changing the pricing integration. */
export function VietQrModal({ isOpen, onClose, planName, planDisplayName, billingCycle, amountVnd, workspaceId }: VietQrModalProps) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [order, setOrder] = useState<CheckoutOrder | null>(null);
    const [qrImage, setQrImage] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setError(null);
            setOrder(null);
            setQrImage(null);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch("/api/payments/vietqr/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ plan: planName, billingCycle, workspaceId }),
                });
                const data = await response.json().catch(() => ({}));
                if (response.status === 401) {
                    const callbackUrl = `/pricing${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`;
                    router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
                    return;
                }
                if (!response.ok || !data?.order || typeof data.order.orderCode !== "number") {
                    throw new Error(typeof data?.error === "string" ? data.error : "PayOS checkout unavailable");
                }
                if (!cancelled) setOrder(data.order as CheckoutOrder);
            } catch (checkoutError) {
                if (!cancelled) setError(checkoutError instanceof Error ? checkoutError.message : "Không thể kết nối PayOS. Vui lòng thử lại sau.");
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, planName, billingCycle, workspaceId, router]);

    useEffect(() => {
        if (!order?.qrCode) {
            setQrImage(null);
            return;
        }
        let cancelled = false;
        void QRCode.toDataURL(order.qrCode, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 320,
            color: { dark: "#081426", light: "#ffffff" },
        }).then((dataUrl) => {
            if (!cancelled) setQrImage(dataUrl);
        }).catch(() => {
            if (!cancelled) setError("Không thể hiển thị mã VietQR. Vui lòng thử lại.");
        });
        return () => { cancelled = true; };
    }, [order?.qrCode]);

    if (!isOpen) return null;
    const amount = order?.amount ?? amountVnd;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur-md sm:py-10">
            <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b] shadow-2xl shadow-black/50 lg:grid-cols-[0.88fr_1.12fr]">
                <section className="relative border-b border-white/10 bg-[#101010] p-7 text-white sm:p-10 lg:border-b-0 lg:border-r">
                    <button onClick={onClose} aria-label="Back to plans" className="inline-flex items-center gap-2 rounded-lg text-sm text-neutral-300 transition hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to plans</button>
                    <button onClick={onClose} aria-label="Close checkout" className="absolute right-5 top-5 rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white lg:hidden"><X className="h-5 w-5" /></button>
                    <div className="mt-12">
                        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-neutral-200"><QrCode className="h-6 w-6" /></div>
                        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-200">Secure VietQR checkout</p>
                        <h2 className="mt-3 text-3xl font-semibold tracking-tight">Complete your plan</h2>
                        <p className="mt-3 max-w-sm text-sm leading-6 text-neutral-400">Scan the code in your banking app or use the transfer details. Your workspace changes only after PayOS verifies the payment.</p>
                    </div>
                    <div className="mt-9 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-white">{planDisplayName}</p><p className="mt-1 text-sm text-neutral-400">{billingCycle === "annual" ? "365-day prepaid access" : "30-day prepaid access"}</p></div><p className="whitespace-nowrap text-base font-semibold text-white">{amount.toLocaleString("vi-VN")} ₫</p></div>
                    </div>
                    <div className="mt-8 space-y-3 text-sm text-neutral-400"><p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-neutral-200" /> Activation after verified payment</p><p className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-neutral-200" /> QR is generated by PayOS for this order</p></div>
                </section>

                <section className="relative min-h-[620px] bg-[#0b0b0b] p-6 text-white sm:p-10">
                    <button onClick={onClose} aria-label="Close checkout" className="absolute right-5 top-5 rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
                    {error ? <div className="flex min-h-[520px] items-center justify-center text-center"><p className="max-w-sm rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</p></div> : !order || !qrImage ? <div className="flex min-h-[520px] flex-col items-center justify-center gap-3 text-center"><Loader2 className="h-7 w-7 animate-spin text-neutral-200" /><p className="text-sm text-neutral-400">Creating your secure payment request…</p></div> : <div className="mx-auto flex min-h-[560px] max-w-md flex-col items-center justify-center text-center"><p className="text-sm font-medium text-neutral-200">Scan to pay with your banking app</p><p className="mt-1 text-xs text-neutral-500">VietQR · One-time order #{order.orderCode}</p><div className="mt-6 max-w-full rounded-2xl bg-white p-4 shadow-2xl shadow-black/20"><img src={qrImage} width={288} height={288} alt="VietQR payment code" className="h-auto w-full max-w-72 rounded-xl" /></div><p className="mt-5 text-lg font-semibold text-white">{amount.toLocaleString("vi-VN")} ₫</p><p className="mt-1 text-sm text-neutral-400">Use the exact amount and transfer note below.</p><div className="mt-6 w-full divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.035] p-1 text-left">{order.accountNo ? <CopyValue label="Account number" value={order.accountNo} /> : null}{order.accountName ? <CopyValue label="Account holder" value={order.accountName} /> : null}<CopyValue label="Transfer note" value={order.memo} /></div>{order.checkoutUrl ? <a href={order.checkoutUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs text-neutral-500 transition hover:text-neutral-200">Having trouble scanning? Open PayOS secure page <ExternalLink className="h-3.5 w-3.5" /></a> : null}</div>}
                </section>
            </div>
        </div>
    );
}
