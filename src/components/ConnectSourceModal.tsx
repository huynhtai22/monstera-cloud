"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, Lock, ArrowRight, ShieldCheck } from "lucide-react";
import useSWR from "swr";
import { toast } from "sonner";
import { useWorkspaceStore } from "@/store/workspace";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { isSourceEnvReady, visibleSourcesCatalog, type SourcesCatalogItem } from "@/lib/sources-integration-catalog";
import { getSourceUIConfig } from "@/lib/source-ui-registry";
import { cn } from "@/lib/utils";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { trackEvent } from "@/lib/analytics-events";
import { useMounted } from "@/hooks/useMounted";
import { LogoMark } from "@/components/Logo";
import { CONSOLE_MOTION } from "@/lib/console-motion";
import styles from "./ConnectSourceModal.module.css";
import { ReportingJourneyMotion } from "./onboarding/ReportingJourneyMotion";

async function integrationsConfigFetcher(url: string) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load");
    return data;
}

interface ConnectSourceModalProps {
    isOpen: boolean;
    onClose: () => void;
    integration: {
        id: string;
        name: string;
        logoSrc: string;
        description: string;
    } | null;
    /** Catalog ids already connected in this workspace; these can add another account. */
    connectedCatalogIds?: string[];
    /** Used by the local visual preview to show the handoff before a real OAuth redirect. */
    previewState?: "preparing" | "opening";
    /** Keeps local design previews interactive without starting a real provider authorization. */
    previewMode?: boolean;
}

const OAUTH_SOURCE_IDS = [
    "shopee",
    "tiktok_shop",
    "tiktok_business",
    "meta_ads",
    "google_ads",
    "shopify",
    "amazon",
    "lazada",
] as const;

function isOAuthSourceId(sourceId: string): boolean {
    return (OAUTH_SOURCE_IDS as readonly string[]).includes(sourceId);
}

const CONNECT_DESCRIPTION: Record<string, string> = {
    meta_ads: "See Facebook and Instagram spend and results together for client reporting.",
    google_ads: "See Google Ads spend and conversions alongside your other reporting sources.",
    tiktok_business: "Bring TikTok ad results into this workspace.",
    tiktok_shop: "Bring orders and product data from your TikTok Shop.",
    shopee: "Bring Shopee orders and sales into your workspace for client reporting.",
    shopify: "Bring orders and products from your Shopify store.",
    lazada: "Bring orders and sales from your Lazada shop.",
    amazon: "Bring orders, inventory, and sales from your Amazon account.",
};

const PICKER_DESCRIPTION: Record<string, string> = {
    meta_ads: "Facebook and Instagram campaign performance.",
    google_ads: "Campaigns, spend, and conversions.",
    tiktok_business: "TikTok campaign and ad performance.",
    tiktok_shop: "TikTok Shop orders and products.",
    shopee: "Orders, products, and store sales.",
    shopify: "Orders and products from your store.",
    lazada: "Orders and sales from your Lazada shop.",
    amazon: "Sales, orders, and inventory.",
};

const PANEL_EASE = CONSOLE_MOTION.easing;
const PANEL_DURATION_MS = CONSOLE_MOTION.normal;

export function ConnectSourceModal({ isOpen, onClose, integration, connectedCatalogIds = [], previewState, previewMode = false }: ConnectSourceModalProps) {
    const mounted = useMounted();
    const [connectionPhase, setConnectionPhase] = useState<"preparing" | "opening" | null>(null);
    const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shopifyRequestAbort = useRef<AbortController | null>(null);
    const isProcessing = connectionPhase !== null;
    const displayPhase = previewState ?? connectionPhase;
    const [shopDomain, setShopDomain] = useState("");
    const [draftPick, setDraftPick] = useState<SourcesCatalogItem | null>(null);

    const [shouldRender, setShouldRender] = useState(isOpen);
    const [isVisible, setIsVisible] = useState(isOpen);

    const connectedSet = useMemo(() => new Set(connectedCatalogIds), [connectedCatalogIds]);
    const effective = integration ?? draftPick;
    const id = effective?.id ?? "";
    const name = effective?.name ?? "";
    const logoSrc = effective?.logoSrc ?? INTEGRATION_LOGOS.shopee;
    const uiConfig = getSourceUIConfig(id);
    const connectDescription = CONNECT_DESCRIPTION[id] ?? `Bring ${name} data into this workspace.`;

    const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
    const { data: intConfig } = useSWR(isOpen ? "/api/integrations/config" : null, integrationsConfigFetcher);

    const step1Content = useMemo(() => {
        if (uiConfig?.stepContent) return uiConfig.stepContent;
        return {
            title: "Authorize access",
            subtitle: `You need to authenticate via ${name}'s platform to grant Monstera Cloud read-only access to your data.`,
            permissions: [
                "Read daily orders and fulfillment status",
                "Read product inventory and variants",
                "Read financial and payout data where applicable",
            ],
            footnote: "Monstera Cloud does not modify your live store or ad campaigns.",
        };
    }, [uiConfig, name]);

    const dialogRef = useRef<HTMLDivElement>(null);
    const previousActiveElement = useRef<Element | null>(null);

    useEffect(() => {
        // The Continue button becomes inert during handoff; keep keyboard focus inside the dialog.
        if (isOpen && displayPhase) dialogRef.current?.focus();
    }, [isOpen, displayPhase]);

    useEffect(() => {
        if (!shouldRender) return;
        previousActiveElement.current = document.activeElement;
        const timer = setTimeout(() => {
            dialogRef.current?.focus();
        }, 50);
        return () => {
            clearTimeout(timer);
            if (previousActiveElement.current instanceof HTMLElement) {
                previousActiveElement.current.focus();
            }
        };
    }, [shouldRender]);

    useEffect(() => {
        if (isOpen) {
            setDraftPick(null);
            setShopDomain("");
            setConnectionPhase(null);
            return;
        }
        if (redirectTimer.current) clearTimeout(redirectTimer.current);
        shopifyRequestAbort.current?.abort();
        const resetTimer = setTimeout(() => {
            setDraftPick(null);
            setShopDomain("");
            setConnectionPhase(null);
        }, PANEL_DURATION_MS);
        return () => clearTimeout(resetTimer);
    }, [isOpen]);

    useEffect(() => () => {
        if (redirectTimer.current) clearTimeout(redirectTimer.current);
        shopifyRequestAbort.current?.abort();
    }, []);

    useEffect(() => {
        if (!shouldRender) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [shouldRender]);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            let settleFrame = 0;
            const raf = requestAnimationFrame(() => {
                settleFrame = requestAnimationFrame(() => setIsVisible(true));
            });
            return () => { cancelAnimationFrame(raf); cancelAnimationFrame(settleFrame); };
        }
        setIsVisible(false);
        const t = setTimeout(() => setShouldRender(false), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : PANEL_DURATION_MS);
        return () => clearTimeout(t);
    }, [isOpen]);

    const pickConnector = useCallback((item: SourcesCatalogItem) => {
        const ready = isSourceEnvReady(item.id, intConfig);
        if (!ready) {
            toast.error("This connector is not enabled on this deployment (missing OAuth env).");
            return;
        }
        setDraftPick(item);
    }, [intConfig]);

    const showPicker = Boolean(!integration && !draftPick);

    const handleAuthenticate = () => {
        if (isProcessing) return;
        // Move focus before Continue becomes inert, including before passive effects run.
        dialogRef.current?.focus();
        if (previewMode) {
            setConnectionPhase("opening");
            return;
        }
        if (!activeWorkspaceId) {
            toast.error("Select a workspace first.");
            return;
        }

        if (!id) {
            toast.error("Choose a connector first.");
            return;
        }

        if (["shopee", "tiktok_business", "meta_ads", "google_ads", "lazada"].includes(id)) {
            setConnectionPhase("opening");
            trackEvent("oauth_started", { provider: id });
            redirectTimer.current = setTimeout(() => {
                // OAuth requires a full document navigation through the server redirect.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign(`${window.location.origin}/api/auth/connect?provider=${encodeURIComponent(id)}&workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
            }, 350);
            return;
        }
        if (id === "shopify") {
            const shop = shopDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
            if (!shop) {
                toast.error("Enter your Shopify store domain first.");
                return;
            }
            setConnectionPhase("preparing");
            trackEvent("oauth_started", { provider: id, shopUrl: shop });
            const requestAbort = new AbortController();
            shopifyRequestAbort.current = requestAbort;
            fetch(`/api/connections/shopify/auth-url?workspaceId=${encodeURIComponent(activeWorkspaceId)}&shop=${encodeURIComponent(shop)}`, { signal: requestAbort.signal })
                .then((r) => r.json())
                .then(({ url, error }) => {
                    if (error || !url) {
                        setConnectionPhase(null);
                        toast.error(error || "Failed to generate Shopify auth URL.");
                        return;
                    }
                    setConnectionPhase("opening");
                    redirectTimer.current = setTimeout(() => { window.location.assign(url); }, 350);
                })
                .catch(() => {
                    if (requestAbort.signal.aborted) return;
                    setConnectionPhase(null);
                    toast.error("Failed to start Shopify authentication.");
                });
            return;
        }

        toast.message("Connector not available yet", {
            description: `${name} is listed in the catalog; the live OAuth flow is not wired for this provider in this release. Use Shopee, Meta Ads, Google Ads, or TikTok for production connections.`,
        });
    };

    const handleClose = () => {
        if (redirectTimer.current) clearTimeout(redirectTimer.current);
        shopifyRequestAbort.current?.abort();
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            if (!isProcessing && !integration && draftPick) {
                setDraftPick(null);
                e.stopPropagation();
                return;
            }
            handleClose();
            return;
        }

        if (e.key === "Tab" && dialogRef.current) {
            const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
            )).filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    };

    const oauthPrimaryDisabled = isOAuthSourceId(id) && !activeWorkspaceId && !previewMode;

    if (!shouldRender || !mounted) return null;

    const dialogMotion = cn(
        "relative flex w-full max-h-[90dvh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141414] shadow-[0_32px_100px_#0009] outline-none",
        "transition-[opacity,transform] duration-[var(--console-duration-normal)] motion-reduce:transition-none motion-reduce:transform-none",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
    );

    const overlay = (
        <div
            className={cn(
                "fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6",
                "pointer-events-auto"
            )}
        >
            <div
                className={cn(
                    "absolute inset-0 bg-black/70 backdrop-blur-[2px]",
                    "transition-opacity duration-[var(--console-duration-fast)] ease-out motion-reduce:transition-none",
                    isVisible ? "opacity-100" : "opacity-0"
                )}
                onClick={handleClose}
            />

            {showPicker ? (
                <div
                    ref={dialogRef}
                    onKeyDown={handleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    inert={!isOpen}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="connect-source-picker-title"
                    tabIndex={-1}
                    className={cn(dialogMotion, styles.surface, "max-w-[640px]")}
                    style={{ transitionTimingFunction: PANEL_EASE, transitionDuration: `${isVisible ? CONSOLE_MOTION.slow : PANEL_DURATION_MS}ms` }}
                >
                    <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-6 pb-5 pt-6 sm:px-8 sm:pt-7">
                        <div className="min-w-0">
                            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.17em] text-[#86c99b]">New connection</p>
                            <h3 id="connect-source-picker-title" className="mt-2.5 text-[27px] font-medium tracking-[-0.045em] text-white sm:text-[31px]">
                                Where is your data?
                            </h3>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-[#a6a6a6]">
                                Choose a platform, then sign in to connect an account.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            aria-label="Close dialog"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-white/[0.05] hover:text-ink"
                        >
                            <X className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                    </div>
                    <ul className="grid flex-1 grid-cols-1 content-start gap-2.5 overflow-y-auto overscroll-contain px-5 py-5 sm:grid-cols-2 sm:gap-3 sm:px-8" aria-label="Available connectors">
                        {visibleSourcesCatalog(intConfig).map((item, index) => {
                            const connected = connectedSet.has(item.id);
                            const ready = isSourceEnvReady(item.id, intConfig);
                            const disabled = !ready;
                            return (
                                <li key={item.id} className={styles.pickerItem} style={{ "--picker-index": Math.min(index, 8) } as React.CSSProperties}>
                                    <button
                                        type="button"
                                        aria-disabled={disabled}
                                        disabled={disabled}
                                        onClick={() => pickConnector(item)}
                                        className={cn(
                                            styles.pickerTile,
                                            disabled
                                                ? "cursor-not-allowed opacity-40"
                                                : "text-ink"
                                        )}
                                    >
                                        <span className={styles.pickerLogo}><IntegrationMark src={item.logoSrc} size="md" /></span>
                                        <span className="mt-4 flex w-full min-w-0 items-center justify-between gap-2">
                                            <span className="truncate text-[14px] font-semibold tracking-[-0.015em] text-white">{item.name}</span>
                                            {!disabled ? <ArrowRight className={styles.pickerArrow} size={16} strokeWidth={1.6} aria-hidden /> : null}
                                        </span>
                                        <span className="mt-1.5 block min-h-[32px] text-[11px] leading-[1.45] text-[#a1a1a1]">
                                            {PICKER_DESCRIPTION[item.id] || item.description}
                                        </span>
                                        <span className={cn(styles.pickerStatus, connected && styles.pickerConnected)}>
                                            <span className={styles.pickerDot} aria-hidden />
                                            {disabled ? "Unavailable" : connected ? "Connected · Add account" : "Ready to connect"}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="flex items-center gap-2 border-t border-white/[0.07] px-6 py-4 text-[11px] text-[#858b86] sm:px-8">
                        <ShieldCheck size={14} className="text-[#86c99b]" aria-hidden />
                        Your credentials stay with the provider. You can disconnect at any time.
                    </div>
                </div>
            ) : (
                <div
                    ref={dialogRef}
                    onKeyDown={handleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    inert={!isOpen}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="connect-source-modal-title"
                    tabIndex={-1}
                    className={cn(dialogMotion, styles.surface, styles.consent, displayPhase && styles.connecting, "max-w-[590px]")}
                    style={{ transitionTimingFunction: PANEL_EASE, transitionDuration: `${isVisible ? CONSOLE_MOTION.slow : PANEL_DURATION_MS}ms` }}
                >
                    <div className="flex items-center justify-between px-6 pt-5 sm:px-8">
                        <div className="flex items-center gap-2.5">
                            <LogoMark className="h-5 w-5 shrink-0" />
                            <span className="text-[11px] font-medium tracking-[0.01em] text-[#c9d0ca]">Monstera Cloud</span>
                        </div>
                        <button type="button" onClick={handleClose} aria-label="Close dialog" className="grid h-8 w-8 place-items-center rounded-lg text-[#969b97] transition-colors hover:bg-white/[0.07] hover:text-white">
                            <X className="h-4 w-4" strokeWidth={1.6} />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5 sm:px-8">
                        <ReportingJourneyMotion compact visual={{ step: "connect", provider: id, logoSrc, running: Boolean(displayPhase) }} />

                        <div className={cn(styles.waitingPanel, displayPhase && styles.waitingPanelActive)} aria-hidden={!displayPhase} inert={!displayPhase} role={displayPhase ? "status" : undefined} aria-live={displayPhase ? "polite" : undefined}>
                            <div className="pb-4 text-center">
                                <p className={styles.statusBadge}><span className={styles.statusDot} aria-hidden="true" />{displayPhase === "preparing" ? "Preparing secure connection" : "Opening secure sign-in"}</p>
                                <h3 id={displayPhase ? "connect-source-modal-title" : undefined} className="text-[28px] font-medium tracking-[-0.045em] text-white">
                                    {displayPhase === "preparing" ? "Preparing your connection" : `Opening ${name}`}
                                </h3>
                                <p className="mx-auto mt-3 max-w-[390px] text-[14px] leading-[1.6] text-[#c6d0c8]">
                                    {displayPhase === "preparing"
                                        ? `Getting a secure sign-in link from ${name}…`
                                        : `Approve access with ${name}. You'll return here to choose the accounts to sync.`}
                                </p>

                                <p className="mt-5 text-[12px] text-[#aab5ac]">Your sign-in happens securely on {name}.</p>
                            </div>
                        </div>

                        <div className={cn(styles.idlePanel, displayPhase && styles.idlePanelHidden)} aria-hidden={Boolean(displayPhase)} inert={Boolean(displayPhase)}>
                            <div className={styles.phaseBody}>
                                <div className={styles.intro}>
                                    <h3 id={!displayPhase ? "connect-source-modal-title" : undefined} className="text-[28px] font-medium tracking-[-0.045em] text-white sm:text-[30px]">Connect {name} to Monstera Cloud</h3>
                                    <p className="mx-auto mt-3 max-w-[420px] text-[14px] leading-[1.6] text-[#afb8b0]">
                                        {connectDescription}
                                    </p>
                                </div>

                                <section className={styles.accessDetails} aria-label="Access for reporting">
                                    <h4 className={styles.accessHeading}><ShieldCheck size={17} aria-hidden /> Access for reporting</h4>
                                    <ul className={styles.permissionList}>
                                        {step1Content.permissions.map((line) => (
                                            <li key={line}><CheckCircle2 size={16} aria-hidden /> <span>{line}</span></li>
                                        ))}
                                    </ul>
                                    <p className={styles.accessNote}>You’ll review the provider’s permissions before approving. After sign-in, choose your accounts and reporting dates.</p>
                                </section>

                                {id === "shopify" && (
                                    <div className="mt-5 space-y-2">
                                        <label htmlFor="shopify-domain" className="font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[#a0a5a1]">{uiConfig?.domainInputLabel ?? "Shopify store domain"}</label>
                                        <input id="shopify-domain" type="text" placeholder={uiConfig?.domainInputPlaceholder ?? "mystore.myshopify.com"} value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} disabled={isProcessing} className="w-full rounded-lg border border-white/[0.12] bg-[#0d0e0d] px-3.5 py-3 text-sm text-white placeholder:text-[#777d79] focus:border-[#b8b8b8]/60 focus:outline-none disabled:opacity-50" />
                                    </div>
                                )}

                                {!integration && draftPick && <button type="button" onClick={() => setDraftPick(null)} className="mt-4 text-[11px] text-[#86c99b] hover:text-white">Choose a different source</button>}
                            </div>
                        </div>
                    </div>

                    <div className={cn(styles.footer, displayPhase && styles.footerHidden, "px-6 pb-7 sm:px-8")} aria-hidden={Boolean(displayPhase)} inert={Boolean(displayPhase)}>
                            <div className={styles.phaseBody}>
                            <div className={styles.actions}>
                                <button type="button" onClick={handleClose} className={styles.cancel}>Cancel</button>
                                <button type="button" onClick={handleAuthenticate} aria-busy={isProcessing} disabled={isProcessing || oauthPrimaryDisabled} className={styles.continue}>
                                    Continue to {name}<ArrowRight size={16} aria-hidden />
                                </button>
                            </div>
                            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-[#858d87]"><Lock className="h-3 w-3 shrink-0" aria-hidden="true" /> Sign in on {name}. Disconnect anytime in Monstera Cloud.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    return createPortal(overlay, document.body);
}
