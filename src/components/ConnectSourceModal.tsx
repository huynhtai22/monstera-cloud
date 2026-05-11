"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { X, Loader2, CheckCircle2, ChevronRight, Globe, Facebook, Copy, Check } from "lucide-react";
import useSWR from "swr";
import { toast } from "sonner";
import { useWorkspaceStore } from "@/store/workspace";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { SOURCES_CATALOG, isSourceEnvReady, type SourcesCatalogItem } from "@/lib/sources-integration-catalog";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics-events";

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
    /** Catalog ids already connected in this workspace (picker rows disabled). */
    connectedCatalogIds?: string[];
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

// Expo-out easing — starts fast, decelerates naturally; same curve used by Linear & Figma
const PANEL_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const PANEL_DURATION_MS = 280;

export function ConnectSourceModal({ isOpen, onClose, integration, connectedCatalogIds = [] }: ConnectSourceModalProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [copiedWhich, setCopiedWhich] = useState<null | "production" | "session">(null);
    const [shopDomain, setShopDomain] = useState("");
    const [draftPick, setDraftPick] = useState<SourcesCatalogItem | null>(null);

    // Keep panel mounted during exit so the slide-out plays before unmounting
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [isVisible, setIsVisible] = useState(isOpen);

    const connectedSet = useMemo(() => new Set(connectedCatalogIds), [connectedCatalogIds]);
    const effective = integration ?? draftPick;
    const id = effective?.id ?? "";
    const name = effective?.name ?? "";
    const logoSrc = effective?.logoSrc ?? INTEGRATION_LOGOS.shopee;

    const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
    const { data: intConfig } = useSWR(isOpen ? "/api/integrations/config" : null, integrationsConfigFetcher);

    const oauthCallbackUrl =
        id === "meta_ads"
            ? intConfig?.oauthCallbacks?.metaAds
            : id === "google_ads"
              ? intConfig?.oauthCallbacks?.googleAds
              : id === "amazon"
                ? intConfig?.oauthCallbacks?.amazon
                : id === "lazada"
                  ? intConfig?.oauthCallbacks?.lazada
                  : undefined;

    const productionOauthUrl =
        id === "meta_ads"
            ? intConfig?.oauthCallbacksProduction?.metaAds
            : id === "google_ads"
              ? intConfig?.oauthCallbacksProduction?.googleAds
              : id === "amazon"
                ? intConfig?.oauthCallbacksProduction?.amazon
                : id === "lazada"
                  ? intConfig?.oauthCallbacksProduction?.lazada
                  : undefined;

    const sessionDiffersFromProduction = Boolean(
        productionOauthUrl && oauthCallbackUrl && oauthCallbackUrl !== productionOauthUrl
    );

    const step1Content = useMemo(() => {
        if (id === "meta_ads") {
            return {
                title: "Sign in with Facebook",
                subtitle:
                    "You'll use your Facebook account to authorize read-only access to Meta Ads (Facebook and Instagram) for reporting in Monstera Cloud.",
                permissions: [
                    "Read ad account structure (campaigns, ad sets, ads)",
                    "Read performance metrics and insights for reporting",
                ],
                footnote: "We never post to Facebook or change your ads on your behalf.",
            };
        }
        if (id === "google_ads") {
            return {
                title: "Sign in with Google",
                subtitle:
                    "You'll use your Google account to authorize read-only access to Google Ads data for reporting in Monstera Cloud.",
                permissions: [
                    "Read accessible Google Ads customer accounts",
                    "Read campaign and performance data for reporting",
                ],
                footnote: "We never modify your Google Ads campaigns.",
            };
        }
        if (id === "lazada") {
            return {
                title: "Authorize with Lazada",
                subtitle:
                    "You will sign in to Lazada Open Platform and approve Monstera Cloud to access seller data allowed by your app registration.",
                permissions: [
                    "Read orders and fulfillment data you authorize",
                    "Store encrypted tokens for scheduled sync to your destinations",
                ],
                footnote: "Redirect URL must match your Lazada app callback exactly.",
            };
        }
        if (id === "amazon") {
            return {
                title: "Authorize in Seller Central",
                subtitle:
                    "You will sign in to Amazon Seller Central and approve our Selling Partner API application (Login with Amazon) for this workspace.",
                permissions: [
                    "Link your selling partner account via Amazon OAuth",
                    "Store encrypted refresh tokens for scheduled SP-API access",
                ],
                footnote: "Scopes follow your app registration in Amazon Developer Central.",
            };
        }
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
    }, [id, name]);

    /* Focus trap: must be declared before any early return (Rules of Hooks) */
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousActiveElement = useRef<Element | null>(null);

    useEffect(() => {
        if (!isOpen) return;
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
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setDraftPick(null);
            setShopDomain("");
            setCopiedWhich(null);
        }
    }, [isOpen]);

    // Drive enter/exit animation
    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            // Double rAF: first paints the element off-screen, second starts the transition
            const raf = requestAnimationFrame(() => {
                requestAnimationFrame(() => setIsVisible(true));
            });
            return () => cancelAnimationFrame(raf);
        }
        setIsVisible(false);
        const t = setTimeout(() => setShouldRender(false), PANEL_DURATION_MS);
        return () => clearTimeout(t);
    }, [isOpen]);

    const pickConnector = useCallback((item: SourcesCatalogItem) => {
        const ready = isSourceEnvReady(item.id, intConfig);
        if (!ready) {
            toast.error("This connector is not enabled on this deployment (missing OAuth env).");
            return;
        }
        if (connectedSet.has(item.id)) {
            toast.message("Already connected", { description: `${item.name} is already linked to this workspace.` });
            return;
        }
        setDraftPick(item);
    }, [intConfig, connectedSet]);

    const showPicker = Boolean(isOpen && !integration && !draftPick);

    const handleAuthenticate = () => {
        setIsProcessing(true);

        if (!activeWorkspaceId) {
            setIsProcessing(false);
            toast.error("Select a workspace first.");
            return;
        }

        if (!id) {
            setIsProcessing(false);
            toast.error("Choose a connector first.");
            return;
        }

        if (id === "shopee") {
            trackEvent("oauth_started", { provider: id });
            // Unified oauth-framework route — replaces /api/auth/shopee/authorize
            window.location.href = `/api/auth/connect?provider=shopee&workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "tiktok_shop") {
            trackEvent("oauth_started", { provider: id });
            window.location.href = `/api/auth/tiktok/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "tiktok_business") {
            trackEvent("oauth_started", { provider: id });
            window.location.href = `/api/auth/tiktok-business/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "meta_ads") {
            trackEvent("oauth_started", { provider: id });
            window.location.href = `/api/auth/meta-ads/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "google_ads") {
            trackEvent("oauth_started", { provider: id });
            window.location.href = `/api/auth/google-ads/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "amazon") {
            trackEvent("oauth_started", { provider: id });
            window.location.href = `/api/auth/amazon/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "lazada") {
            trackEvent("oauth_started", { provider: id });
            // Unified oauth-framework route — replaces /api/auth/lazada/authorize
            window.location.href = `/api/auth/connect?provider=lazada&workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "shopify") {
            const shop = shopDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
            if (!shop) {
                setIsProcessing(false);
                toast.error("Enter your Shopify store domain first.");
                return;
            }
            trackEvent("oauth_started", { provider: id, shopUrl: shop });
            fetch(`/api/connections/shopify/auth-url?workspaceId=${encodeURIComponent(activeWorkspaceId)}&shop=${encodeURIComponent(shop)}`)
                .then((r) => r.json())
                .then(({ url, error }) => {
                    if (error || !url) {
                        setIsProcessing(false);
                        toast.error(error || "Failed to generate Shopify auth URL.");
                        return;
                    }
                    window.location.href = url;
                })
                .catch(() => {
                    setIsProcessing(false);
                    toast.error("Failed to start Shopify authentication.");
                });
            return;
        }

        setIsProcessing(false);
        toast.message("Connector not available yet", {
            description: `${name} is listed in the catalog; the live OAuth flow is not wired for this provider in this release. Use Shopee, Meta Ads, Google Ads, or TikTok for production connections.`,
        });
    };

    const handleClose = () => {
        if (!isProcessing) {
            setCopiedWhich(null);
            setShopDomain("");
            setDraftPick(null);
            onClose();
        }
    };

    const copyOAuthCallback = async (url: string, which: "production" | "session") => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopiedWhich(which);
            setTimeout(() => setCopiedWhich(null), 2000);
        } catch {
            /* ignore */
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape" && !isProcessing) {
            if (!integration && draftPick) {
                setDraftPick(null);
                e.stopPropagation();
                return;
            }
            handleClose();
            return;
        }

        if (e.key === "Tab" && dialogRef.current) {
            const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
            );
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

    const oauthPrimaryDisabled = isOAuthSourceId(id) && !activeWorkspaceId;

    if (!shouldRender) return null;

    return (
        <div
            className={cn(
                "fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4",
                "transition-opacity duration-200 ease-out",
                isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            onClick={(e) => { if (e.target === e.currentTarget && !isProcessing) handleClose(); }}
        >
            {showPicker ? (
                <div
                    ref={dialogRef}
                    onKeyDown={handleKeyDown}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="connect-source-picker-title"
                    tabIndex={-1}
                    className={cn(
                        "relative w-full max-w-md max-h-[85vh] overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl ring-1 ring-slate-900/[0.04] outline-none dark:border-white/10 dark:bg-[#000000]/95 dark:ring-white/[0.06] flex flex-col",
                        "transition-all duration-[280ms]",
                        isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
                    )}
                    style={{ transitionTimingFunction: PANEL_EASE }}
                >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100/90 bg-gradient-to-br from-slate-50/90 to-white px-5 py-4 dark:border-white/5 dark:from-slate-800/80 dark:to-slate-900/80">
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Catalog</p>
                            <h3 id="connect-source-picker-title" className="mt-1 text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                                Add a data source
                            </h3>
                            <p className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-400">
                                Same list as the header menu — includes connectors already linked or not yet configured on this server.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            aria-label="Close dialog"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-white"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <ul
                        className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 py-2"
                        role="listbox"
                        aria-label="Available connectors"
                    >
                        {SOURCES_CATALOG.map((item) => {
                            const connected = connectedSet.has(item.id);
                            const ready = isSourceEnvReady(item.id, intConfig);
                            const disabled = connected || !ready;
                            return (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-disabled={disabled}
                                        disabled={disabled}
                                        onClick={() => pickConnector(item)}
                                        className={cn(
                                            "group flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-all duration-150",
                                            disabled
                                                ? "cursor-not-allowed opacity-50 saturate-50"
                                                : "text-slate-900 hover:bg-slate-50/95 hover:shadow-sm focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-cyan-500/35 dark:text-white dark:hover:bg-[#16181c]/90 dark:focus-visible:bg-slate-800/90 dark:focus-visible:ring-cyan-400/30"
                                        )}
                                    >
                                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white to-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-slate-200/80 dark:from-slate-800 dark:to-slate-900 dark:ring-white/10">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={item.logoSrc} alt="" width={24} height={24} className="object-contain" />
                                        </span>
                                        <span className="min-w-0 flex-1 pt-0.5">
                                            <span className="flex items-start justify-between gap-2">
                                                <span className="flex flex-wrap items-center gap-2">
                                                    <span className="text-[13px] font-semibold leading-tight tracking-tight text-slate-900 dark:text-white">
                                                        {item.name}
                                                    </span>
                                                    {connected ? (
                                                        <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-200">
                                                            Linked
                                                        </span>
                                                    ) : null}
                                                </span>
                                                {!disabled ? (
                                                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-600 dark:text-slate-600 dark:group-hover:text-cyan-400" />
                                                ) : !ready ? (
                                                    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-950/80 dark:text-amber-200">
                                                        Off
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="mt-1 block line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                                {item.description}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="border-t border-slate-100 bg-slate-50/90 p-2 dark:border-white/5 dark:bg-[#000000]/60">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex w-full items-center justify-center rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-[#16181c]/80 dark:text-slate-200 dark:hover:bg-[#16181c]"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
            <div
                ref={dialogRef}
                onKeyDown={handleKeyDown}
                role="dialog"
                aria-modal="true"
                aria-labelledby="connect-source-modal-title"
                tabIndex={-1}
                className={cn(
                    "relative w-full max-w-lg max-h-[85vh] overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl ring-1 ring-slate-900/[0.04] outline-none dark:border-white/10 dark:bg-[#000000]/95 dark:ring-white/[0.06] flex flex-col",
                    "transition-all duration-[280ms]",
                    isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
                )}
                style={{ transitionTimingFunction: PANEL_EASE }}
            >
                <div className="flex items-center gap-3 border-b border-slate-100/90 bg-gradient-to-br from-slate-50/90 to-white px-5 py-4 dark:border-white/5 dark:from-slate-800/80 dark:to-slate-900/80">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-white to-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-slate-200/80 dark:from-slate-800 dark:to-slate-900 dark:ring-white/10">
                        <Image src={logoSrc} alt={name} width={22} height={22} className="object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">OAuth</p>
                        <h3 id="connect-source-modal-title" className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                            {name}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Sign in on the next step — read-only access.</p>
                    </div>
                    {!integration && draftPick ? (
                        <button
                            type="button"
                            onClick={() => setDraftPick(null)}
                            disabled={isProcessing}
                            className="shrink-0 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 shadow-sm transition-colors hover:bg-cyan-50 disabled:opacity-50 dark:border-white/10 dark:bg-[#16181c] dark:text-cyan-300 dark:hover:bg-cyan-950/40"
                        >
                            Change
                        </button>
                    ) : null}
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        aria-label="Close dialog"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-200/80 hover:text-slate-800 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                    <div
                        className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-[240ms]"
                        style={{ animationTimingFunction: PANEL_EASE }}
                    >
                        <div className="mb-5">
                            <h4 className="text-base font-bold text-gray-900 dark:text-white mb-1">{step1Content.title}</h4>
                            <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{step1Content.subtitle}</p>
                        </div>

                        {(() => {
                            const panelClass = cn(
                                "rounded-2xl border p-5 space-y-3",
                                // Light mode surface
                                "bg-gradient-to-br from-slate-50/80 to-white border-slate-200/80",
                                // Dark mode surface (higher contrast + consistent across sources)
                                "dark:from-slate-900/60 dark:to-slate-950/40 dark:border-[#2f3336]/70",
                                // Accent by source (subtle, like Cursor)
                                id === "meta_ads" && "ring-1 ring-[#1877F2]/15 dark:ring-[#1877F2]/20",
                                id === "google_ads" && "ring-1 ring-emerald-500/10 dark:ring-emerald-400/15",
                                (id === "shopee" || id === "lazada") && "ring-1 ring-amber-500/10 dark:ring-amber-400/15",
                                (id === "tiktok_shop" || id === "tiktok_business") && "ring-1 ring-fuchsia-500/10 dark:ring-fuchsia-400/15",
                                id === "amazon" && "ring-1 ring-indigo-500/10 dark:ring-indigo-400/15",
                                id === "shopify" && "ring-1 ring-green-500/10 dark:ring-green-400/15",
                            );

                            const iconClass =
                                id === "meta_ads"
                                    ? "text-[#1877F2]"
                                    : id === "google_ads"
                                      ? "text-emerald-600 dark:text-emerald-300"
                                      : id === "shopee" || id === "lazada"
                                        ? "text-amber-600 dark:text-amber-300"
                                        : id === "tiktok_shop" || id === "tiktok_business"
                                          ? "text-fuchsia-600 dark:text-fuchsia-300"
                                          : id === "amazon"
                                            ? "text-indigo-600 dark:text-indigo-300"
                                            : id === "shopify"
                                              ? "text-green-700 dark:text-green-300"
                                              : "text-cyan-700 dark:text-cyan-300";

                            return (
                                <div className={panelClass}>
                                    <p className="font-semibold text-gray-900 dark:text-white text-sm flex items-center">
                                        <Globe className={cn("w-4 h-4 mr-2 shrink-0", iconClass)} />
                                        Permissions requested
                                    </p>
                            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300 ml-6">
                                {step1Content.permissions.map((line) => (
                                    <li key={line} className="flex items-start">
                                        <CheckCircle2 className="w-4 h-4 text-cyan-500 mr-2 shrink-0 mt-0.5" />
                                        {line}
                                    </li>
                                ))}
                            </ul>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 italic">{step1Content.footnote}</p>
                                </div>
                            );
                        })()}

                        {id === "shopify" && (
                            <div className="space-y-1.5">
                                <label htmlFor="shopify-domain" className="text-xs font-semibold text-gray-700 dark:text-slate-300">
                                    Your Shopify store domain
                                </label>
                                <input
                                    id="shopify-domain"
                                    type="text"
                                    placeholder="mystore.myshopify.com"
                                    value={shopDomain}
                                    onChange={(e) => setShopDomain(e.target.value)}
                                    disabled={isProcessing}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#2f3336] bg-white dark:bg-[#000000] text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
                                />
                            </div>
                        )}

                        {(id === "meta_ads" || id === "google_ads" || id === "amazon" || id === "lazada") && (
                            <div className="rounded-xl border border-dashed border-slate-300 dark:border-[#2f3336] bg-slate-50/90 dark:bg-[#000000]/50 p-4 space-y-3">
                                <div>
                                    <p className="text-xs font-semibold text-gray-800 dark:text-slate-200">
                                        {id === "meta_ads"
                                            ? "Meta — Valid OAuth Redirect URI"
                                            : id === "google_ads"
                                              ? "Google Cloud — Authorized redirect URI"
                                              : id === "amazon"
                                                ? "Amazon — Allowed OAuth redirect URI"
                                                : "Lazada — Callback URL (OAuth redirect)"}
                                    </p>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug mt-1">
                                        Production domain{" "}
                                        <span className="font-medium text-gray-700 dark:text-slate-300">monsteracloud.com</span> —
                                        paste this full URL into your developer console (exact match, including{" "}
                                        <code className="text-gray-700 dark:text-slate-300">https</code>).
                                    </p>
                                </div>
                                {productionOauthUrl ? (
                                    <div className="flex gap-2 items-start">
                                        <code className="text-[11px] leading-relaxed break-all flex-1 text-gray-900 dark:text-slate-100 bg-white dark:bg-[#16181c] px-2.5 py-2 rounded-lg border border-slate-200 dark:border-[#2f3336]">
                                            {productionOauthUrl}
                                        </code>
                                        <button
                                            type="button"
                                            onClick={() => copyOAuthCallback(productionOauthUrl, "production")}
                                            className="shrink-0 p-2 rounded-lg border border-slate-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] text-gray-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1d1f23] transition-colors"
                                            title="Copy production URL"
                                        >
                                            {copiedWhich === "production" ? (
                                                <Check className="w-4 h-4 text-cyan-600" aria-hidden />
                                            ) : (
                                                <Copy className="w-4 h-4" aria-hidden />
                                            )}
                                        </button>
                                    </div>
                                ) : intConfig ? (
                                    <p className="text-[11px] text-amber-600 dark:text-amber-500">
                                        Could not load production callback URL.
                                    </p>
                                ) : (
                                    <p className="text-[11px] text-gray-400 dark:text-gray-500 animate-pulse">Loading…</p>
                                )}
                                {sessionDiffersFromProduction && oauthCallbackUrl && (
                                    <div className="pt-2 border-t border-slate-200 dark:border-[#2f3336] space-y-1.5">
                                        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                            This session (local / preview)
                                        </p>
                                        <div className="flex gap-2 items-start">
                                            <code className="text-[11px] leading-relaxed break-all flex-1 text-gray-600 dark:text-slate-400 bg-white/70 dark:bg-[#16181c]/80 px-2 py-1.5 rounded border border-slate-200 dark:border-[#2f3336]">
                                                {oauthCallbackUrl}
                                            </code>
                                            <button
                                                type="button"
                                                onClick={() => copyOAuthCallback(oauthCallbackUrl, "session")}
                                                className="shrink-0 p-2 rounded-lg border border-slate-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] text-gray-500 hover:bg-slate-50 dark:hover:bg-[#1d1f23] text-[10px] px-2"
                                            >
                                                {copiedWhich === "session" ? "Copied" : "Copy"}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-100 dark:border-[#2f3336] flex justify-end gap-3">
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>

                    {id === "meta_ads" && (
                        <button
                            type="button"
                            onClick={handleAuthenticate}
                            disabled={isProcessing || oauthPrimaryDisabled}
                            className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1877F2] rounded-xl hover:bg-[#166FE5] transition-all disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm min-w-[200px]"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                    Connecting…
                                </>
                            ) : (
                                <>
                                    <Facebook className="w-5 h-5 shrink-0" strokeWidth={2} aria-hidden />
                                    Continue with Facebook
                                </>
                            )}
                        </button>
                    )}

                    {id === "google_ads" && (
                        <button
                            type="button"
                            onClick={handleAuthenticate}
                            disabled={isProcessing || oauthPrimaryDisabled}
                            className="px-5 py-2.5 text-sm font-semibold text-gray-800 dark:text-gray-100 bg-white dark:bg-[#16181c] border border-gray-300 dark:border-[#2f3336] rounded-xl hover:bg-gray-50 dark:hover:bg-[#1d1f23] transition-all disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm min-w-[200px]"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                    Connecting…
                                </>
                            ) : (
                                <>
                                    <Image
                                        src={INTEGRATION_LOGOS.googleAds}
                                        alt=""
                                        width={20}
                                        height={20}
                                        className="object-contain shrink-0"
                                    />
                                    Continue with Google
                                </>
                            )}
                        </button>
                    )}

                    {id !== "meta_ads" && id !== "google_ads" && (
                        <button
                            type="button"
                            onClick={handleAuthenticate}
                            disabled={isProcessing || oauthPrimaryDisabled}
                            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-cyan-600 rounded-xl hover:bg-cyan-700 transition-all disabled:opacity-70 shadow-sm min-w-[180px]"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin shrink-0" /> Connecting…
                                </>
                            ) : (
                                <>
                                    Continue to {name} <ChevronRight className="w-4 h-4 shrink-0" />
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
            )}
        </div>
    );
}
