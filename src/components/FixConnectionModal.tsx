"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { X, AlertCircle, RefreshCw, CheckCircle2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import {
    resolveReconnectVerification,
    type ReconnectStatusSnapshot,
} from "@/lib/reconnect-verification";
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
        managerBadge?: string | null;
        accountEmail?: string | null;
    } | null;
    onReconnected: () => void;
}

type FixStep = "diagnose" | "reconnect" | "success" | "error";

const DIALOG_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const DIALOG_DURATION_MS = 280;
const RECONNECT_TIMEOUT_MS = 10 * 60 * 1000;

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
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousActiveElement = useRef<HTMLElement | null>(null);
    const popupRef = useRef<Window | null>(null);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const verificationAbortRef = useRef<AbortController | null>(null);

    const clearReconnectPolling = useCallback((closePopup = false) => {
        if (pollIntervalRef.current) {
            clearTimeout(pollIntervalRef.current as unknown as number);
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        if (pollTimeoutRef.current) {
            clearTimeout(pollTimeoutRef.current);
            pollTimeoutRef.current = null;
        }
        verificationAbortRef.current?.abort();
        verificationAbortRef.current = null;
        if (closePopup && popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
        }
        popupRef.current = null;
    }, []);

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
        clearReconnectPolling(true);
        reset();
        onClose();
    }, [clearReconnectPolling, reset, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        previousActiveElement.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return () => {
            const previous = previousActiveElement.current;
            if (previous?.isConnected) {
                previous.focus();
                return;
            }
            document
                .querySelector<HTMLElement>("[data-dashboard-focus-fallback]")
                ?.focus();
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const frame = requestAnimationFrame(() => dialogRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [isOpen, step]);

    useEffect(() => () => clearReconnectPolling(true), [clearReconnectPolling]);

    const handleDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            handleClose();
            return;
        }
        if (event.key !== "Tab" || !dialogRef.current) return;

        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        );
        if (focusable.length === 0) {
            event.preventDefault();
            dialogRef.current.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (document.activeElement === dialogRef.current) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
            return;
        }
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }, [handleClose]);

    // Analyze the error to determine the issue
    const diagnosis = (() => {
        if (!connection) return null;
        
        const msg = connection.errorMsg?.toLowerCase() || "";
        
        if (msg.includes("token") || msg.includes("expired") || msg.includes("401") || msg.includes("unauthorized")) {
            return {
                type: "token_expired" as const,
                title: "Access token expired",
                description: "Your authorization with this platform expired or was revoked.",
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
            description: "The connection is not working properly and needs to be reauthorized.",
            action: "Try reconnecting to restore the connection.",
        };
    })();

    const handleReconnect = useCallback(async () => {
        if (!connection) return;

        clearReconnectPolling(true);
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
                throw new Error("Could not start reconnection. Please try again.");
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

                popupRef.current = popup;
                const baselineUpdatedAt = String(data.baselineUpdatedAt || "");
                let verificationInFlight = false;
                let popupClosedAt: number | null = null;
                let consecutive429s = 0;
                let isTerminated = false;

                const verifyReconnect = async () => {
                    if (verificationInFlight || isTerminated) return;
                    verificationInFlight = true;
                    const controller = new AbortController();
                    verificationAbortRef.current = controller;

                    try {
                        const statusResponse = await fetch(
                            `/api/connections/${connection.id}/status`,
                            { signal: controller.signal },
                        );

                        if (statusResponse.status === 429) {
                            // Back off gracefully on rate limit instead of aborting
                            consecutive429s++;
                            scheduleNextPoll(Math.min(3000 * Math.pow(1.5, consecutive429s), 10000));
                            return;
                        }

                        consecutive429s = 0;
                        if (!statusResponse.ok) throw new Error("status_unavailable");
                        const status = (await statusResponse.json()) as ReconnectStatusSnapshot;
                        const providerError = typeof status.lastError === "string"
                            ? status.lastError.trim()
                            : "";
                        const baselineTimestamp = new Date(baselineUpdatedAt).getTime();
                        const statusTimestamp = new Date(status.updatedAt).getTime();
                        const hasFreshProviderError = Boolean(
                            providerError &&
                            Number.isFinite(baselineTimestamp) &&
                            Number.isFinite(statusTimestamp) &&
                            statusTimestamp > baselineTimestamp,
                        );

                        if (hasFreshProviderError) {
                            isTerminated = true;
                            clearReconnectPolling(true);
                            setStep("error");
                            setError(providerError);
                            setIsReconnecting(false);
                            return;
                        }

                        if (popup.closed && popupClosedAt === null) popupClosedAt = Date.now();
                        const popupCancellationConfirmed = Boolean(
                            popupClosedAt && Date.now() - popupClosedAt >= 2_000,
                        );
                        const outcome = resolveReconnectVerification({
                            snapshot: status,
                            baselineUpdatedAt,
                            popupClosed: popupCancellationConfirmed,
                            timedOut: false,
                        });

                        if (outcome === "success") {
                            isTerminated = true;
                            clearReconnectPolling(true);
                            setStep("success");
                            setIsReconnecting(false);
                            onReconnected();
                            return;
                        } else if (outcome === "cancelled") {
                            isTerminated = true;
                            clearReconnectPolling(false);
                            setStep("error");
                            setError("Authorization was closed before the connection was restored.");
                            setIsReconnecting(false);
                            return;
                        }

                        // Continue polling while still pending
                        if (!popup.closed) {
                            scheduleNextPoll(2500);
                        } else {
                            // Popup just closed, do a couple more quick checks before finalizing
                            scheduleNextPoll(1000);
                        }
                    } catch (verificationError) {
                        if (verificationError instanceof DOMException && verificationError.name === "AbortError") {
                            return;
                        }
                        if (popup.closed) {
                            isTerminated = true;
                            clearReconnectPolling(false);
                            setStep("error");
                            setError("Could not verify reconnection status. Please try again.");
                            setIsReconnecting(false);
                        } else {
                            // Retry with a slightly longer delay on temporary network error
                            scheduleNextPoll(3500);
                        }
                    } finally {
                        verificationInFlight = false;
                        if (verificationAbortRef.current === controller) {
                            verificationAbortRef.current = null;
                        }
                    }
                };

                const scheduleNextPoll = (delayMs: number) => {
                    if (isTerminated) return;
                    if (pollIntervalRef.current) {
                        clearTimeout(pollIntervalRef.current as unknown as number);
                    }
                    pollIntervalRef.current = setTimeout(() => {
                        void verifyReconnect();
                    }, delayMs) as unknown as ReturnType<typeof setInterval>;
                };

                // Initial poll after brief pause to allow popup to load
                scheduleNextPoll(1200);

                pollTimeoutRef.current = setTimeout(() => {
                    isTerminated = true;
                    const outcome = resolveReconnectVerification({
                        snapshot: null,
                        baselineUpdatedAt,
                        popupClosed: popup.closed,
                        timedOut: true,
                    });
                    clearReconnectPolling(true);
                    setStep("error");
                    setError(
                        outcome === "timeout"
                            ? "Authorization timed out. Start the reconnection again when you are ready."
                            : "Reconnection was not completed. Please try again.",
                    );
                    setIsReconnecting(false);
                }, RECONNECT_TIMEOUT_MS);
            } else {
                throw new Error("Could not start reconnection. Please try again.");
            }
        } catch {
            setStep("error");
            setError("Could not reconnect. Please try again.");
            setIsReconnecting(false);
        }
    }, [clearReconnectPolling, connection, onReconnected]);

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
        )} role="presentation">
            {/* Backdrop */}
            <div
                className={cn(
                    "absolute inset-0 bg-black/70 backdrop-blur-[2px]",
                    "transition-opacity duration-200 ease-out motion-reduce:transition-none",
                    isVisible ? "opacity-100" : "opacity-0"
                )}
                onClick={handleClose}
                aria-hidden="true"
            />

            {/* Modal */}
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="fix-connection-title"
                aria-describedby="fix-connection-description"
                tabIndex={-1}
                onKeyDown={handleDialogKeyDown}
                className={cn(
                    "relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-line bg-panel outline-none",
                    "transition-[opacity,transform] duration-[280ms] motion-reduce:transition-none motion-reduce:transform-none",
                    isVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
                )}
                style={{ transitionTimingFunction: DIALOG_EASE }}
            >
                {/* Header */}
                <div className="h-[2px] w-full bg-amber-400/80" />
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                    <div className="flex items-center gap-3">
                        <IntegrationMark src={logo} size="md" />
                        <div>
                            <h2 id="fix-connection-title" className="text-lg font-semibold text-ink">
                                Fix Connection
                            </h2>
                            <p id="fix-connection-description" className="sr-only">
                                Review the connection issue and restore authorization.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        aria-label="Close connection dialog"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                    >
                        <X className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto overscroll-contain p-6">
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
                            <div className="rounded-md border border-line bg-canvas p-3 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">Connection</p>
                                    {connection.managerBadge && (
                                        <span className="rounded border border-line/80 bg-panel px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-mute">
                                            {connection.managerBadge}
                                        </span>
                                    )}
                                </div>
                                <p className="font-medium text-ink">{connection.name}</p>
                                {connection.accountEmail && (
                                    <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                                        <span className="text-ink-mute">Authorized Account:</span>
                                        <span className="font-mono font-medium">{connection.accountEmail}</span>
                                    </div>
                                )}
                                {connection.lastSync && connection.lastSync !== "Never" && (
                                    <p className="text-xs text-ink-mute">
                                        Last successful sync: {connection.lastSync}
                                    </p>
                                )}
                            </div>

                            {/* Account Guidance Note */}
                            {connection.provider === "google_ads" && (
                                <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-300">
                                    {connection.accountEmail ? (
                                        <span>
                                            Please make sure you log into <strong className="font-semibold text-emerald-200">{connection.accountEmail}</strong> in the Google authorization popup to restore access.
                                        </span>
                                    ) : (
                                        <span>
                                            Please log into the Google Account with manager access to {connection.managerBadge || "this MCC"}. Reconnecting will permanently link your Gmail address to this source.
                                        </span>
                                    )}
                                </div>
                            )}

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
                                <RefreshCw className="h-8 w-8 text-accent motion-safe:animate-spin" strokeWidth={1.5} />
                            </div>
                            <h3 className="text-lg font-semibold text-ink">
                                Waiting for authorization...
                            </h3>
                            <p className="mt-2 text-sm text-ink-mute">
                                Complete the authentication in the popup window.
                            </p>
                            <p className="mt-4 text-xs text-ink-mute">
                                Don't close this window until you're done.
                            </p>
                        </div>
                    )}

                    {step === "success" && (
                        <div className="py-8 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-950/40">
                                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-ink">
                                Connection restored!
                            </h3>
                            <p className="mt-2 text-sm text-ink-mute">
                                Your {connection.name} connection is working again.
                            </p>
                            <p className="mt-1 text-sm text-ink-mute">
                                Run a sync when you&apos;re ready to update Warehouse data.
                            </p>
                            <PrimaryButton onClick={handleClose} className="mt-6 w-full">
                                Done
                            </PrimaryButton>
                        </div>
                    )}

                    {step === "error" && (
                        <div className="py-6 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-950/40">
                                <AlertCircle className="h-10 w-10 text-red-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-ink">
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
                                    Close
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
