"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X, Loader2, CheckCircle2, ChevronRight, Copy, Check, Lock, Shield } from "lucide-react";
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

const PROVIDER_ACCENT: Record<string, string> = {
    meta_ads: "#1877F2",
    google_ads: "#4285F4",
    tiktok_business: "#FE2C55",
    tiktok_shop: "#FE2C55",
    shopee: "#EE4D2D",
    shopify: "#95BF47",
    amazon: "#FF9900",
    lazada: "#0F146D",
};

const PANEL_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const PANEL_DURATION_MS = 280;

export function ConnectSourceModal({ isOpen, onClose, integration, connectedCatalogIds = [] }: ConnectSourceModalProps) {
    const mounted = useMounted();
    const [isProcessing, setIsProcessing] = useState(false);
    const [copiedWhich, setCopiedWhich] = useState<null | "production" | "session">(null);
    const [shopDomain, setShopDomain] = useState("");
    const [draftPick, setDraftPick] = useState<SourcesCatalogItem | null>(null);

    const [shouldRender, setShouldRender] = useState(isOpen);
    const [isVisible, setIsVisible] = useState(isOpen);

    const connectedSet = useMemo(() => new Set(connectedCatalogIds), [connectedCatalogIds]);
    const effective = integration ?? draftPick;
    const id = effective?.id ?? "";
    const name = effective?.name ?? "";
    const logoSrc = effective?.logoSrc ?? INTEGRATION_LOGOS.shopee;
    const accent = PROVIDER_ACCENT[id] ?? "#67e8f9";
    const uiConfig = getSourceUIConfig(id);

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

    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
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
        setDraftPick(item);
    }, [intConfig]);

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

        if (["shopee", "tiktok_business", "meta_ads", "google_ads", "lazada"].includes(id)) {
            trackEvent("oauth_started", { provider: id });
            window.location.href = `/api/auth/connect?provider=${encodeURIComponent(id)}&workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
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

    if (!shouldRender || !mounted) return null;

    const dialogMotion = cn(
        "relative flex w-full max-h-[88vh] flex-col overflow-hidden rounded-lg border border-line bg-panel outline-none",
        "transition-[opacity,transform] duration-[280ms] motion-reduce:transition-none motion-reduce:transform-none",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
    );

    const overlay = (
        <div
            className={cn(
                "fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6",
                !isVisible && "pointer-events-none"
            )}
        >
            <div
                className={cn(
                    "absolute inset-0 bg-black/70 backdrop-blur-[2px]",
                    "transition-opacity duration-200 ease-out motion-reduce:transition-none",
                    isVisible ? "opacity-100" : "opacity-0"
                )}
                onClick={() => { if (!isProcessing) handleClose(); }}
            />

            {showPicker ? (
                <div
                    ref={dialogRef}
                    onKeyDown={handleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="connect-source-picker-title"
                    tabIndex={-1}
                    className={cn(dialogMotion, "max-w-[440px]")}
                    style={{ transitionTimingFunction: PANEL_EASE }}
                >
                    <div className="h-px w-full bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
                    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                        <div className="min-w-0">
                            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">Catalog</p>
                            <h3 id="connect-source-picker-title" className="mt-1 text-lg font-semibold tracking-tight text-ink">
                                Add a data source
                            </h3>
                            <p className="mt-1 text-xs leading-relaxed text-ink-mute">
                                Certified pilot sources: Meta Ads, Google Ads, TikTok Ads, and Shopee.
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
                    <ul
                        className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 py-2"
                        role="listbox"
                        aria-label="Available connectors"
                    >
                        {visibleSourcesCatalog(intConfig).map((item) => {
                            const connected = connectedSet.has(item.id);
                            const ready = isSourceEnvReady(item.id, intConfig);
                            const disabled = !ready;
                            return (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected="false"
                                        aria-disabled={disabled}
                                        disabled={disabled}
                                        onClick={() => pickConnector(item)}
                                        className={cn(
                                            "group flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left transition-colors",
                                            disabled
                                                ? "cursor-not-allowed opacity-40"
                                                : "text-ink hover:bg-white/[0.04] focus:outline-none focus-visible:bg-white/[0.05]"
                                        )}
                                    >
                                        <IntegrationMark src={item.logoSrc} size="md" />
                                        <span className="min-w-0 flex-1 pt-0.5">
                                            <span className="flex items-start justify-between gap-2">
                                                <span className="flex flex-wrap items-center gap-2">
                                                    <span className="text-[13px] font-semibold leading-tight text-ink">
                                                        {item.name}
                                                    </span>
                                                    {connected ? (
                                                        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide text-accent">
                                                            Linked
                                                        </span>
                                                    ) : null}
                                                </span>
                                                {!disabled ? (
                                                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-mute group-hover:text-ink" strokeWidth={1.5} />
                                                ) : (
                                                    <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-mute">
                                                        Off
                                                    </span>
                                                )}
                                            </span>
                                            <span className="mt-1 block line-clamp-2 text-[11px] leading-snug text-ink-mute">
                                                {item.description}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="border-t border-line p-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex w-full items-center justify-center rounded-md border border-line bg-transparent px-3 py-2.5 text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div
                    ref={dialogRef}
                    onKeyDown={handleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="connect-source-modal-title"
                    tabIndex={-1}
                    className={cn(dialogMotion, "max-w-[480px]")}
                    style={{ transitionTimingFunction: PANEL_EASE }}
                >
                    <div className="h-[2px] w-full" style={{ background: accent }} />

                    <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                        <IntegrationMark src={logoSrc} alt={name} size="lg" />
                        <div className="min-w-0 flex-1">
                            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">
                                Read-only OAuth
                            </p>
                            <h3 id="connect-source-modal-title" className="truncate text-base font-semibold tracking-tight text-ink">
                                {name}
                            </h3>
                        </div>
                        {!integration && draftPick ? (
                            <button
                                type="button"
                                onClick={() => setDraftPick(null)}
                                disabled={isProcessing}
                                className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink disabled:opacity-50"
                            >
                                Change
                            </button>
                        ) : null}
                        <button
                            onClick={handleClose}
                            disabled={isProcessing}
                            aria-label="Close dialog"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-white/[0.05] hover:text-ink disabled:opacity-50"
                        >
                            <X className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-5">
                        <ol className="mb-5 grid grid-cols-2 gap-2">
                            <li className="rounded-md border border-line bg-white/[0.03] px-3 py-2">
                                <p className="font-mono text-[10px] text-accent">01</p>
                                <p className="mt-0.5 text-xs font-medium text-ink">Review access</p>
                            </li>
                            <li className="rounded-md border border-line px-3 py-2">
                                <p className="font-mono text-[10px] text-ink-mute">02</p>
                                <p className="mt-0.5 text-xs font-medium text-ink-mute">Sign in on {name}</p>
                            </li>
                        </ol>

                        <div className="mb-4">
                            <h4 className="text-base font-semibold text-ink">{step1Content.title}</h4>
                            <p className="mt-1 text-sm leading-relaxed text-ink-mute">{step1Content.subtitle}</p>
                        </div>

                        <div className="overflow-hidden rounded-md border border-line">
                            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                                <Shield className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                                    Permissions requested
                                </p>
                            </div>
                            <ul className="divide-y divide-line">
                                {step1Content.permissions.map((line) => (
                                    <li key={line} className="flex items-start gap-2.5 px-3 py-2.5 text-sm text-ink">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                                        {line}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-ink-mute">{step1Content.footnote}</p>

                        {id === "shopify" && (
                            <div className="mt-4 space-y-1.5">
                                <label htmlFor="shopify-domain" className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                                    {uiConfig?.domainInputLabel ?? "Shopify store domain"}
                                </label>
                                <input
                                    id="shopify-domain"
                                    type="text"
                                    placeholder={uiConfig?.domainInputPlaceholder ?? "mystore.myshopify.com"}
                                    value={shopDomain}
                                    onChange={(e) => setShopDomain(e.target.value)}
                                    disabled={isProcessing}
                                    className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-mute/70 focus:border-white/25 focus:outline-none disabled:opacity-50"
                                />
                            </div>
                        )}

                        {(id === "meta_ads" || id === "google_ads" || id === "amazon" || id === "lazada") && (
                            <div className="mt-4 space-y-2 rounded-md border border-dashed border-line px-3 py-3">
                                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                                    {id === "meta_ads"
                                        ? "Meta — Valid OAuth Redirect URI"
                                        : id === "google_ads"
                                          ? "Google Cloud — Authorized redirect URI"
                                          : id === "amazon"
                                            ? "Amazon — Allowed OAuth redirect URI"
                                            : "Lazada — Callback URL"}
                                </p>
                                <p className="text-[11px] leading-snug text-ink-mute">
                                    Production domain{" "}
                                    <span className="text-ink">monsteracloud.com</span> — paste the full URL into the developer console.
                                </p>
                                {productionOauthUrl ? (
                                    <div className="flex items-start gap-2">
                                        <code className="flex-1 break-all rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink">
                                            {productionOauthUrl}
                                        </code>
                                        <button
                                            type="button"
                                            onClick={() => copyOAuthCallback(productionOauthUrl, "production")}
                                            className="shrink-0 rounded-md border border-line p-2 text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink"
                                            title="Copy production URL"
                                        >
                                            {copiedWhich === "production" ? (
                                                <Check className="h-4 w-4 text-accent" strokeWidth={1.5} aria-hidden />
                                            ) : (
                                                <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                                            )}
                                        </button>
                                    </div>
                                ) : intConfig ? (
                                    <p className="text-[11px] text-amber-400">Could not load production callback URL.</p>
                                ) : (
                                    <p className="animate-pulse text-[11px] text-ink-mute">Loading…</p>
                                )}
                                {sessionDiffersFromProduction && oauthCallbackUrl && (
                                    <div className="space-y-1.5 border-t border-line pt-2">
                                        <p className="font-mono text-[10px] uppercase tracking-wide text-ink-mute">
                                            This session (local / preview)
                                        </p>
                                        <div className="flex items-start gap-2">
                                            <code className="flex-1 break-all rounded-md border border-line bg-canvas/70 px-2 py-1.5 font-mono text-[11px] text-ink-mute">
                                                {oauthCallbackUrl}
                                            </code>
                                            <button
                                                type="button"
                                                onClick={() => copyOAuthCallback(oauthCallbackUrl, "session")}
                                                className="shrink-0 rounded-md border border-line px-2 py-1.5 font-mono text-[10px] text-ink-mute hover:text-ink"
                                            >
                                                {copiedWhich === "session" ? "Copied" : "Copy"}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-ink-mute">
                            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.5} />
                            <span>Tokens encrypted at rest. Read-only scopes. You can revoke access anytime in the provider console.</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
                        <button
                            onClick={handleClose}
                            disabled={isProcessing}
                            className="rounded-md px-3 py-2 text-sm font-medium text-ink-mute transition-colors hover:text-ink disabled:opacity-50"
                        >
                            Cancel
                        </button>

                        {id === "meta_ads" && (
                            <button
                                type="button"
                                onClick={handleAuthenticate}
                                disabled={isProcessing || oauthPrimaryDisabled}
                                className="inline-flex min-w-[200px] items-center justify-center gap-2 rounded-md bg-[#1877F2] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#166FE5] disabled:opacity-70"
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                        Connecting…
                                    </>
                                ) : (
                                    <>
                                        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden>
                                            <path d="M13.5 21v-7.5h2.5l.4-3H13.5V8.6c0-.9.3-1.5 1.6-1.5H16.5V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.3V21h3.2z" />
                                        </svg>
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
                                className="inline-flex min-w-[200px] items-center justify-center gap-2 rounded-md border border-line bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 disabled:opacity-70"
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                        Connecting…
                                    </>
                                ) : (
                                    <>
                                        <Image
                                            src={INTEGRATION_LOGOS.googleAds}
                                            alt=""
                                            width={18}
                                            height={18}
                                            className="shrink-0 object-contain"
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
                                className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Connecting…
                                    </>
                                ) : (
                                    <>
                                        Continue to {name} <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );

    return createPortal(overlay, document.body);
}
