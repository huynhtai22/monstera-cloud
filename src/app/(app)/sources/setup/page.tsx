"use client";

import React, { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
    CheckCircle2,
    ArrowRight,
    Database,
    FileSpreadsheet,
    BarChart3,
    Loader2,
    X,
} from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { useWorkspaceStore } from "@/store/workspace";
import { getSourceUIConfig } from "@/lib/source-ui-registry";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import useSWR from "swr";
import { trackEvent } from "@/lib/analytics-events";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Post-OAuth Setup Page
 * Explicit pipeline creation flow - replaces auto-pipeline creation
 *
 * URL: /sources/setup?newConnectionId=xxx&provider=shopee
 *
 * This page shows after successful OAuth, letting users:
 * 1. See what they just connected
 * 2. Choose where data should go (destination)
 * 3. Or skip if using add-on / Looker connector directly
 */

// Wrapper component for Suspense boundary
function SourceSetupPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { activeWorkspaceId } = useWorkspaceStore();

    const newConnectionId = searchParams.get("newConnectionId");
    const provider = searchParams.get("provider");
    const error = searchParams.get("error");

    const [selectedDestination, setSelectedDestination] = useState<string | null>(
        null
    );
    const [isCreating, setIsCreating] = useState(false);
    const [setupComplete, setSetupComplete] = useState(false);
    
    // P1: Account selection for multi-account sources (Meta, Google Ads, etc.)
    const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);
    const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
    const [showAccountStep, setShowAccountStep] = useState(false);

    const { data: connection, isLoading: connectionLoading } = useSWR(
        newConnectionId && activeWorkspaceId
            ? `/api/connections/${newConnectionId}`
            : null,
        fetcher
    );

    const { data: destinations, isLoading: destinationsLoading } = useSWR(
        activeWorkspaceId
            ? `/api/workspaces/${activeWorkspaceId}/connections?type=destination`
            : null,
        fetcher
    );

    const sourceConfig = useMemo(() => {
        if (!provider) return null;
        return getSourceUIConfig(provider);
    }, [provider]);
    
    // P1: Fetch available accounts for multi-account sources
    useEffect(() => {
        if (connection?.id && provider && ["meta_ads", "google_ads", "tiktok_business"].includes(provider)) {
            setIsLoadingAccounts(true);
            fetch(`/api/connections/${connection.id}/accounts`)
                .then(r => r.json())
                .then(data => {
                    if (data.accounts?.length > 0) {
                        setAvailableAccounts(data.accounts);
                        // Pre-select all accounts by default
                        setSelectedAccounts(data.accounts.map((a: any) => a.id));
                        setShowAccountStep(true);
                    }
                })
                .catch(() => {
                    // Silently fail - not all sources support account listing
                })
                .finally(() => setIsLoadingAccounts(false));
        }
    }, [connection, provider]);

    useEffect(() => {
        if (error) {
            toast.error("Connection failed", {
                description: searchParams.get("message") || "Authorization failed",
            });
            trackEvent("oauth_callback_error", { error, provider });
        }
    }, [error, provider, searchParams]);

    const handleCreatePipeline = async () => {
        if (!selectedDestination || !newConnectionId || !activeWorkspaceId) {
            toast.error("Please select a destination");
            return;
        }

        setIsCreating(true);

        try {
            const res = await fetch("/api/pipelines", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    workspaceId: activeWorkspaceId,
                    sourceConnectionId: newConnectionId,
                    destinationConnectionId: selectedDestination,
                    name: `${sourceConfig?.name || "Source"} → Destination`,
                    // P1: Include selected accounts for multi-account sources
                    selectedAccounts: selectedAccounts.length > 0 ? selectedAccounts : undefined,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to create pipeline");
            }

            setSetupComplete(true);
            trackEvent("pipeline_created_from_setup", {
                provider,
                destinationId: selectedDestination,
            });

            toast.success("Pipeline created", {
                description: "Your data will now sync automatically.",
            });
        } catch (e: unknown) {
            toast.error(
                e instanceof Error ? e.message : "Failed to create pipeline"
            );
        } finally {
            setIsCreating(false);
        }
    };

    const handleSkip = () => {
        // User is using add-on or Looker connector directly
        trackEvent("setup_skipped_add_on_path", { provider });
        router.push("/sources");
    };

    const handleDone = () => {
        router.push("/sources");
    };

    if (!newConnectionId || !provider) {
        return (
            <PageShell>
                <EmptyState
                    icon={<X className="h-12 w-12" />}
                    title="Invalid setup link"
                    description="Missing connection information. Please try connecting your source again."
                    primaryAction={
                        <Link
                            href="/sources"
                            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700"
                        >
                            Go to Sources
                        </Link>
                    }
                />
            </PageShell>
        );
    }

    if (connectionLoading || destinationsLoading) {
        return (
            <PageShell>
                <div className="flex h-96 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
                </div>
            </PageShell>
        );
    }

    if (!connection) {
        return (
            <PageShell>
                <EmptyState
                    icon={<Database className="h-12 w-12" />}
                    title="Connection not found"
                    description="The connection you're trying to set up doesn't exist or has been removed."
                    primaryAction={
                        <Link
                            href="/sources"
                            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700"
                        >
                            Back to Sources
                        </Link>
                    }
                />
            </PageShell>
        );
    }

    const availableDestinations = destinations?.filter(
        (d: any) => d.type === "destination"
    );

    return (
        <PageShell>
            <div className="mx-auto max-w-2xl">
                {/* Header */}
                <div className="mb-8 text-center">
                    <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-100 dark:bg-cyan-900/30">
                        {setupComplete ? (
                            <CheckCircle2 className="h-8 w-8 text-cyan-600 dark:text-cyan-400" />
                        ) : (
                            <img
                                src={logoPathForConnectionProvider(provider)}
                                alt={sourceConfig?.name || provider}
                                className="h-10 w-10 object-contain"
                            />
                        )}
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {setupComplete
                            ? "Setup complete!"
                            : `${sourceConfig?.name || provider} connected`}
                    </h1>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">
                        {setupComplete
                            ? "Your data pipeline is ready and will sync automatically."
                            : "Choose where your data should go, or skip if using the add-on / Looker connector."}
                    </p>
                </div>

                {!setupComplete ? (
                    <>
                        {/* Connection card */}
                        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-[#2f3336] dark:bg-[#000000]">
                            <div className="flex items-center gap-3">
                                <img
                                    src={logoPathForConnectionProvider(provider)}
                                    alt={connection.name}
                                    className="h-8 w-8 object-contain"
                                />
                                <div>
                                    <p className="font-semibold text-gray-900 dark:text-white">
                                        {connection.name}
                                    </p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        Connected and ready
                                    </p>
                                </div>
                                <CheckCircle2 className="ml-auto h-5 w-5 text-emerald-500" />
                            </div>
                        </div>

                        {/* P1: Account Selection for multi-account sources */}
                        {showAccountStep && availableAccounts.length > 0 && (
                            <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-[#2f3336] dark:bg-[#000000]">
                                <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">
                                    Select accounts to sync
                                </h3>
                                <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                                    We found {availableAccounts.length} {availableAccounts.length === 1 ? "account" : "accounts"}. 
                                    Choose which ones to include in your sync.
                                </p>
                                
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {availableAccounts.map((account) => (
                                        <label
                                            key={account.id}
                                            className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50 dark:border-[#2f3336] dark:hover:bg-[#16181c] cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedAccounts.includes(account.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedAccounts([...selectedAccounts, account.id]);
                                                    } else {
                                                        setSelectedAccounts(selectedAccounts.filter(id => id !== account.id));
                                                    }
                                                }}
                                                className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-gray-900 dark:text-white truncate">
                                                    {account.name}
                                                </p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    ID: {account.id}
                                                </p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                
                                <div className="mt-3 flex items-center justify-between">
                                    <button
                                        onClick={() => setSelectedAccounts(availableAccounts.map(a => a.id))}
                                        className="text-xs text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                                    >
                                        Select all
                                    </button>
                                    <button
                                        onClick={() => setSelectedAccounts([])}
                                        className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                                    >
                                        Clear all
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Destination selection */}
                        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                            Where should data go?
                        </h2>

                        {availableDestinations?.length > 0 ? (
                            <div className="mb-6 space-y-3">
                                {availableDestinations.map((dest: any) => (
                                    <button
                                        key={dest.id}
                                        onClick={() =>
                                            setSelectedDestination(dest.id)
                                        }
                                        className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                                            selectedDestination === dest.id
                                                ? "border-cyan-500 bg-cyan-50 dark:border-cyan-500 dark:bg-cyan-900/20"
                                                : "border-gray-200 bg-white hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#000000] dark:hover:bg-[#16181c]"
                                        }`}
                                    >
                                        {dest.provider ===
                                        "google_sheets" ? (
                                            <FileSpreadsheet className="h-6 w-6 text-green-600" />
                                        ) : dest.provider ===
                                          "looker_studio" ? (
                                            <BarChart3 className="h-6 w-6 text-cyan-600" />
                                        ) : (
                                            <Database className="h-6 w-6 text-gray-500" />
                                        )}
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-white">
                                                {dest.name}
                                            </p>
                                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                                {dest.provider ===
                                                "google_sheets"
                                                    ? "Google Sheets"
                                                    : dest.provider ===
                                                      "looker_studio"
                                                    ? "Looker Studio"
                                                    : dest.provider}
                                            </p>
                                        </div>
                                        {selectedDestination === dest.id && (
                                            <CheckCircle2 className="ml-auto h-5 w-5 text-cyan-500" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="mb-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center dark:border-[#2f3336] dark:bg-[#000000]/50">
                                <Database className="mx-auto mb-2 h-8 w-8 text-gray-400" />
                                <p className="text-gray-600 dark:text-gray-400">
                                    No destinations connected yet.
                                </p>
                                <Link
                                    href="/destinations"
                                    className="mt-2 inline-block text-sm font-semibold text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                                >
                                    Add a destination →
                                </Link>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <button
                                onClick={handleCreatePipeline}
                                disabled={
                                    !selectedDestination ||
                                    isCreating ||
                                    availableDestinations?.length === 0
                                }
                                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isCreating ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Creating pipeline...
                                    </>
                                ) : (
                                    <>
                                        Create pipeline
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </button>

                            <button
                                onClick={handleSkip}
                                className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:text-gray-300 dark:hover:bg-[#16181c]"
                            >
                                Skip — using add-on / Looker
                            </button>
                        </div>

                        <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
                            “Skip” means you&apos;ll pull data via the Google Sheets
                            add-on or Looker Studio connector instead of console
                            pipelines.
                        </p>
                    </>
                ) : (
                    // Success state
                    <div className="text-center">
                        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800/50 dark:bg-emerald-900/20">
                            <h3 className="mb-2 font-semibold text-emerald-900 dark:text-emerald-100">
                                Pipeline active
                            </h3>
                            <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                Data will sync automatically from{" "}
                                {sourceConfig?.name || provider} to your
                                selected destination. View progress in Reports.
                            </p>
                        </div>

                        <button
                            onClick={handleDone}
                            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-700"
                        >
                            Done
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>
        </PageShell>
    );
}

// Export with Suspense boundary for Next.js static generation
export default function SourceSetupPage() {
    return (
        <Suspense
            fallback={
                <PageShell>
                    <div className="flex h-96 items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
                    </div>
                </PageShell>
            }
        >
            <SourceSetupPageContent />
        </Suspense>
    );
}
