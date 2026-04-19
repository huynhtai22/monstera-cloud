"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { X, Loader2, CheckCircle2, ChevronRight, Globe, Facebook, Copy, Check } from "lucide-react";
import useSWR from "swr";
import { toast } from "sonner";
import { useWorkspaceStore } from "@/store/workspace";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { SOURCES_CATALOG, isSourceEnvReady, type SourcesCatalogItem } from "@/lib/sources-integration-catalog";

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

const OAUTH_SOURCE_IDS = ["shopee", "tiktok_shop", "tiktok_business", "meta_ads", "google_ads", "shopify"] as const;

function isOAuthSourceId(sourceId: string): boolean {
    return (OAUTH_SOURCE_IDS as readonly string[]).includes(sourceId);
}

export function ConnectSourceModal({ isOpen, onClose, integration, connectedCatalogIds = [] }: ConnectSourceModalProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [copiedWhich, setCopiedWhich] = useState<null | "production" | "session">(null);
    const [shopDomain, setShopDomain] = useState("");
    const [draftPick, setDraftPick] = useState<SourcesCatalogItem | null>(null);

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
              : undefined;

    const productionOauthUrl =
        id === "meta_ads"
            ? intConfig?.oauthCallbacksProduction?.metaAds
            : id === "google_ads"
              ? intConfig?.oauthCallbacksProduction?.googleAds
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
            window.location.href = `/api/auth/shopee/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "tiktok_shop") {
            window.location.href = `/api/auth/tiktok/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "tiktok_business") {
            window.location.href = `/api/auth/tiktok-business/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "meta_ads") {
            window.location.href = `/api/auth/meta-ads/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "google_ads") {
            window.location.href = `/api/auth/google-ads/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }
        if (id === "shopify") {
            const shop = shopDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
            if (!shop) {
                setIsProcessing(false);
                toast.error("Enter your Shopify store domain first.");
                return;
            }
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 dark:bg-slate-800/60 backdrop-blur-sm animate-in fade-in duration-200">
            {showPicker ? (
                <div
                    ref={dialogRef}
                    onKeyDown={handleKeyDown}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="connect-source-picker-title"
                    tabIndex={-1}
                    className="relative mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl outline-none animate-in zoom-in-95 duration-300 dark:border-slate-700 dark:bg-slate-800"
                >
                    <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-slate-700">
                        <div>
                            <h3 id="connect-source-picker-title" className="text-base font-bold text-gray-900 dark:text-white">
                                Add a data source
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Choose a platform to connect with OAuth.</p>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            aria-label="Close dialog"
                            className="shrink-0 text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <ul className="max-h-[min(70vh,440px)] space-y-1 overflow-y-auto p-3" role="listbox" aria-label="Available connectors">
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
                                        className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                                            disabled
                                                ? "cursor-not-allowed border-gray-100 bg-gray-50/80 opacity-60 dark:border-slate-700/50 dark:bg-slate-900/40"
                                                : "border-transparent bg-white hover:border-cyan-200 hover:bg-cyan-50/50 dark:bg-slate-800 dark:hover:border-cyan-800/60 dark:hover:bg-cyan-950/20"
                                        }`}
                                    >
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-900">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={item.logoSrc} alt="" width={24} height={24} className="object-contain" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-semibold text-gray-900 dark:text-white">{item.name}</span>
                                                {connected ? (
                                                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                                                        Connected
                                                    </span>
                                                ) : null}
                                                {!ready ? (
                                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                                                        Not configured
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="mt-0.5 block text-xs leading-snug text-gray-500 dark:text-gray-400">
                                                {item.description}
                                            </span>
                                        </span>
                                        {!disabled ? (
                                            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="border-t border-gray-100 px-6 py-3 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"
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
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden relative animate-in zoom-in-95 duration-300 border border-gray-200 dark:border-slate-700 outline-none"
            >
                <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
                        <Image src={logoSrc} alt={name} width={22} height={22} className="object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 id="connect-source-modal-title" className="text-sm font-bold text-gray-900 dark:text-white">
                            {name}
                        </h3>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Connect via OAuth</p>
                    </div>
                    {!integration && draftPick ? (
                        <button
                            type="button"
                            onClick={() => setDraftPick(null)}
                            disabled={isProcessing}
                            className="shrink-0 text-xs font-semibold text-cyan-600 hover:text-cyan-700 disabled:opacity-50 dark:text-cyan-400 dark:hover:text-cyan-300"
                        >
                            Change
                        </button>
                    ) : null}
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        aria-label="Close dialog"
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50 shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-6">
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="mb-5">
                            <h4 className="text-base font-bold text-gray-900 dark:text-white mb-1">{step1Content.title}</h4>
                            <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{step1Content.subtitle}</p>
                        </div>

                        <div
                            className={
                                id === "meta_ads"
                                    ? "bg-[#1877F2]/10 dark:bg-[#1877F2]/15 rounded-xl p-5 border border-[#1877F2]/25 space-y-3"
                                    : id === "google_ads"
                                      ? "bg-slate-50 dark:bg-slate-900/50 rounded-xl p-5 border border-slate-200 dark:border-slate-600 space-y-3"
                                      : "bg-blue-50/50 rounded-xl p-5 border border-blue-100 dark:border-blue-900/40 space-y-3"
                            }
                        >
                            <p className="font-semibold text-gray-900 dark:text-white text-sm flex items-center">
                                <Globe
                                    className={`w-4 h-4 mr-2 shrink-0 ${
                                        id === "meta_ads" ? "text-[#1877F2]" : "text-blue-600"
                                    }`}
                                />
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
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
                                />
                            </div>
                        )}

                        {(id === "meta_ads" || id === "google_ads") && (
                            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/90 dark:bg-slate-900/50 p-4 space-y-3">
                                <div>
                                    <p className="text-xs font-semibold text-gray-800 dark:text-slate-200">
                                        {id === "meta_ads"
                                            ? "Meta — Valid OAuth Redirect URI"
                                            : "Google Cloud — Authorized redirect URI"}
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
                                        <code className="text-[11px] leading-relaxed break-all flex-1 text-gray-900 dark:text-slate-100 bg-white dark:bg-slate-800 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-600">
                                            {productionOauthUrl}
                                        </code>
                                        <button
                                            type="button"
                                            onClick={() => copyOAuthCallback(productionOauthUrl, "production")}
                                            className="shrink-0 p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
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
                                    <div className="pt-2 border-t border-slate-200 dark:border-slate-600 space-y-1.5">
                                        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                            This session (local / preview)
                                        </p>
                                        <div className="flex gap-2 items-start">
                                            <code className="text-[11px] leading-relaxed break-all flex-1 text-gray-600 dark:text-slate-400 bg-white/70 dark:bg-slate-800/80 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600">
                                                {oauthCallbackUrl}
                                            </code>
                                            <button
                                                type="button"
                                                onClick={() => copyOAuthCallback(oauthCallbackUrl, "session")}
                                                className="shrink-0 p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-500 hover:bg-slate-50 dark:hover:bg-slate-700 text-[10px] px-2"
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

                <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 flex justify-end gap-3">
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
                            className="px-5 py-2.5 text-sm font-semibold text-gray-800 dark:text-gray-100 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-all disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm min-w-[200px]"
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
