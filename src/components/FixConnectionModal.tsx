"use client";

import { useState, useCallback } from "react";
import { X, AlertCircle, RefreshCw, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";

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

export function FixConnectionModal({
    isOpen,
    onClose,
    connection,
    onReconnected,
}: FixConnectionModalProps) {
    const [step, setStep] = useState<FixStep>("diagnose");
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    if (!isOpen || !connection) return null;

    const logo = logoPathForConnectionProvider(connection.provider);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={handleClose}
            />
            
            {/* Modal */}
            <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <img src={logo} alt="" className="h-6 w-6 object-contain" />
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                            Fix Connection
                        </h2>
                    </div>
                    <button
                        onClick={handleClose}
                        className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800 dark:hover:text-gray-300"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {step === "diagnose" && diagnosis && (
                        <div className="space-y-4">
                            {/* Error icon */}
                            <div className="flex items-start gap-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                                    <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900 dark:text-white">
                                        {diagnosis.title}
                                    </h3>
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                        {diagnosis.description}
                                    </p>
                                </div>
                            </div>

                            {/* Info box */}
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-950/30">
                                <p className="text-sm text-amber-800 dark:text-amber-200">
                                    <span className="font-medium">What will happen:</span>{" "}
                                    {diagnosis.action} Your existing data and pipelines will be preserved.
                                </p>
                            </div>

                            {/* Connection details */}
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Connection</p>
                                <p className="font-medium text-gray-900 dark:text-white">{connection.name}</p>
                                {connection.lastSync && connection.lastSync !== "Never" && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        Last successful sync: {connection.lastSync}
                                    </p>
                                )}
                            </div>

                            {/* Action button */}
                            <button
                                onClick={handleReconnect}
                                className={cn(
                                    "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold transition-all",
                                    "bg-cyan-600 text-white hover:bg-cyan-700",
                                    "dark:bg-cyan-600 dark:hover:bg-cyan-500"
                                )}
                            >
                                Reconnect Now
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        </div>
                    )}

                    {step === "reconnect" && (
                        <div className="py-8 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                                <RefreshCw className="h-10 w-10 animate-spin text-cyan-600 dark:text-cyan-400" />
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
                            <button
                                onClick={handleClose}
                                className={cn(
                                    "mt-6 w-full rounded-lg px-4 py-2.5 font-semibold",
                                    "bg-cyan-600 text-white hover:bg-cyan-700",
                                    "dark:bg-cyan-600 dark:hover:bg-cyan-500"
                                )}
                            >
                                Done
                            </button>
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
                                <button
                                    onClick={() => setStep("diagnose")}
                                    className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
                                >
                                    Try Again
                                </button>
                                <a
                                    href={`/sources/${connection.id}`}
                                    onClick={handleClose}
                                    className="flex-1 rounded-lg bg-cyan-600 px-4 py-2.5 text-center font-medium text-white hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-500"
                                >
                                    View Details
                                </a>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
