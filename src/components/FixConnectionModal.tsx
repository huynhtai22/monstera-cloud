"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, AlertCircle, RefreshCw, CheckCircle2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { PrimaryButton, SecondaryButton, IntegrationMark } from "@/components/ui";
import { useMounted } from "@/hooks/useMounted";

interface FixConnectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    connection: {
        id: string;
        name: string;
        provider: string;
        catalogId: string;
        status: string;
        errorMsg?: string;
        lastSync?: string;
    } | null;
    onReconnected: () => void;
}

type FixStep = "diagnose" | "reconnect" | "success" | "error";

const DIALOG_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const DIALOG_DURATION_MS = 280;

export function FixConnectionModal({
    isOpen,
    onClose,
    connection,
    onReconnected,
}: FixConnectionModalProps) {
    const mounted = useMounted();
    const [step, setStep] = useState<FixStep>("diagnose");
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [shouldRender, setShouldRender] = useState(isOpen);
    const [isVisible, setIsVisible] = useState(isOpen);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            const raf = requestAnimationFrame(() => {
                requestAnimationFrame(() => setIsVisible(true));
            });
            return () => cancelAnimationFrame(raf);
        }
        setIsVisible(false);
        const t = setTimeout(() => setShouldRender(false), DIALOG_DURATION_MS);
        return () => clearTimeout(t);
    }, [isOpen]);

    const reset = useCallback(() => {
        setStep("diagnose");
        setIsReconnecting(false);
        setError(null);
    }, []);

    const handleClose = useCallback(() => {
        reset();
        onClose();
    }, [reset, onClose]);

    // Analyze the error to determine the issue
    const diagnosis = (() => {
        if (!connection) return null;
        
        const msg = connection.errorMsg?.toLowerCase() || "";
        
        if (msg.includes("token") || msg.includes("expired") || msg.includes("401") || msg.includes("unauthorized")) {
            return {
                type: "token_expired" as const,
                title: "Access token expired",
                description: "Your authorization with this platform has expired. This happens automatically after 60-90 days for security.",
                action: "Reconnect with the same permissions to restore access.",
            };
        }
        
        if (msg.includes("permission") || msg.includes("scope") || msg.includes("403")) {
            return {
                type: "permissions" as const,
                title: "Permissions changed",
                description: "The platform reports missing permissions. This can happen if account settings were changed.",
                action: "Reconnect to grant the required permissions.",
            };
        }
        
        if (msg.includes("shop") || msg.includes("account") || msg.includes("not found")) {
            return {
                type: "account_issue" as const,
                title: "Account access issue",
                description: "We can't access the linked shop/account. It may have been deactivated or removed.",
                action: "Check your account status on the platform, then reconnect.",
            };
        }
        
        return {
            type: "unknown" as const,
            title: "Connection issue",
            description: connection.errorMsg || "The connection is not working properly.",
            action: "Try reconnecting to restore the connection.",
        };
    })();

    const handleReconnect = useCallback(async () => {
        if (!connection) return;
        
        setIsReconnecting(true);
        setStep("reconnect");
        
        try {
            // Call API to initiate reconnection
            const res = await fetch("/api/connections/reconnect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    connectionId: connection.id,
                    provider: connection.catalogId,
                }),
            });
            
            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error || "Failed to initiate reconnection");
            }
            
            if (data.authUrl) {
                // Open OAuth in popup
                const width = 600;
                const height = 700;
                const left = window.screenX + (window.outerWidth - width) / 2;
                const top = window.screenY + (window.outerHeight - height) / 2;
                
                const popup = window.open(
                    data.authUrl,
                    "Reconnect",
                    `width=${width},height=${height},left=${left},top=${top},popup=1`
                );
                
                if (!popup) {
                    // Popup blocked - redirect instead
                    window.location.href = data.authUrl;
                    return;
                }
                
                // Poll for completion
                const checkClosed = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(checkClosed);
                        // Verify reconnection
                        fetch(`/api/connections/${connection.id}/status`)
                            .then(r => r.json())
                            .then(status => {
                                if (status.status === "connected") {
                                    setStep("success");
                                    onReconnected();
                                } else {
                                    setStep("error");
                                    setError("Reconnection not completed. Please try again.");
                                }
                            })
                            .catch(() => {
                                setStep("error");
                                setError("Could not verify reconnection status.");
                            })
                            .finally(() => setIsReconnecting(false));
                    }
                }, 500);
            } else {
                throw new Error("No authorization URL returned");
            }
        } catch (err) {
            setStep("error");
            setError(err instanceof Error ? err.message : "Unknown error");
            setIsReconnecting(false);
        }
    }, [connection, onReconnected]);

    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [isOpen]);

    if (!shouldRender || !connection || !mounted) return null;

    const logo = logoPathForConnectionProvider(connection.provider);

    const overlay = (
        <div className={cn(
            "fixed inset-0 z-[100] flex items-center justify-center p-4",
            !isVisible && "pointer-events-none"
        )}>
            {/* Backdrop */}
            <div
                className={cn(
                    "absolute inset-0 bg-black/70 backdrop-blur-[2px]",
                    "transition-opacity duration-200 ease-out",
                    isVisible ? "opacity-100" : "opacity-0"
                )}
                onClick={handleClose}
            />

            {/* Modal */}
            <div
                className={cn(
                    "relative w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel",
                    "transition-[opacity,transform] duration-[280ms] motion-reduce:transition-none",
                    isVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
                )}
                style={{ transitionTimingFunction: DIALOG_EASE }}
            >
                {/* Header */}
                <div className="h-[2px] w-full bg-amber-400/80" />
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                    <div className="flex items-center gap-3">
                        <IntegrationMark src={logo} size="md" />
                        <h2 className="text-lg font-semibold text-ink">
                            Fix Connection
                        </h2>
                    </div>
                    <button
                        onClick={handleClose}
                        className="rounded-md p-1 text-ink-mute hover:bg-white/[0.04] hover:text-ink"
                    >
                        <X className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {step === "diagnose" && diagnosis && (
                        <div className="space-y-4">
                            {/* Error icon */}
                            <div className="flex items-start gap-4">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-red-500/30 bg-red-950/40">
                                    <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-ink">
                                        {diagnosis.title}
                                    </h3>
                                    <p className="mt-1 text-sm text-ink-mute">
                                        {diagnosis.description}
                                    </p>
                                </div>
                            </div>

                            {/* Info box */}
                            <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-4">
                                <p className="text-sm text-amber-800 dark:text-amber-200">
                                    <span className="font-medium">What will happen:</span>{" "}
                                    {diagnosis.action} Your existing data and pipelines will be preserved.
                                </p>
                            </div>

                            {/* Connection details */}
                            <div className="rounded-md border border-line bg-canvas p-3">
                                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">Connection</p>
                                <p className="font-medium text-ink">{connection.name}</p>
                                {connection.lastSync && connection.lastSync !== "Never" && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        Last successful sync: {connection.lastSync}
                                    </p>
                                )}
                            </div>

                            {/* Action button */}
                            <PrimaryButton onClick={handleReconnect} disabled={isReconnecting} className="w-full py-3">
                                Reconnect Now
                                <ArrowRight className="h-4 w-4" />
                            </PrimaryButton>
                        </div>
                    )}

                    {step === "reconnect" && (
                        <div className="py-8 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                                <RefreshCw className="h-8 w-8 animate-spin text-accent" strokeWidth={1.5} />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                Waiting for authorization...
                            </h3>
                            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                                Complete the authentication in the popup window.
                            </p>
                            <p className="mt-4 text-xs text-gray-500 dark:text-gray-500">
                                Don't close this window until you're done.
                            </p>
                        </div>
                    )}

                    {step === "success" && (
                        <div className="py-8 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                                <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                Connection restored!
                            </h3>
                            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                                Your {connection.name} connection is working again.
                            </p>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                Syncs will resume automatically.
                            </p>
                            <PrimaryButton onClick={handleClose} className="mt-6 w-full">
                                Done
                            </PrimaryButton>
                        </div>
                    )}

                    {step === "error" && (
                        <div className="py-6 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                                <AlertCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                Could not reconnect
                            </h3>
                            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                                {error}
                            </p>
                            <div className="mt-6 flex gap-3">
                                <SecondaryButton
                                    onClick={() => setStep("diagnose")}
                                    className="flex-1"
                                >
                                    Try Again
                                </SecondaryButton>
                                <PrimaryButton
                                    onClick={handleClose}
                                    className="flex-1"
                                >
                                    View Details
                                </PrimaryButton>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}
