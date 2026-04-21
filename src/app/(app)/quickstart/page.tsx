"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Store, FileSpreadsheet, BarChart3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SOURCES_CATALOG } from "@/lib/sources-integration-catalog";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";

type Step = "source" | "destination" | "confirm" | "complete";

export default function QuickStartPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>("source");
    const [selectedSource, setSelectedSource] = useState<string | null>(null);
    const [selectedDestination, setSelectedDestination] = useState<string | null>("google_sheets");
    const [isConnecting, setIsConnecting] = useState(false);

    const handleSourceSelect = useCallback((sourceId: string) => {
        setSelectedSource(sourceId);
        setStep("destination");
    }, []);

    const handleDestinationSelect = useCallback((destId: string) => {
        setSelectedDestination(destId);
        setStep("confirm");
    }, []);

    const handleConnect = useCallback(async () => {
        if (!selectedSource) return;
        
        setIsConnecting(true);
        
        try {
            // Find the source config
            const source = SOURCES_CATALOG.find(s => s.id === selectedSource);
            if (!source) throw new Error("Source not found");

            // All sources in quickstart use OAuth
            // Initiate OAuth flow via the unified connect endpoint
            const res = await fetch(`/api/auth/connect?provider=${selectedSource}`);
            const data = await res.json();
            
            if (data.url) {
                window.location.href = data.url;
                return;
            } else {
                throw new Error("No authorization URL returned");
            }
        } catch (err) {
            toast.error("Failed to start connection. Please try again.");
            setIsConnecting(false);
        }
    }, [selectedSource, router]);

    const steps = [
        { id: "source", label: "Source", icon: Store },
        { id: "destination", label: "Destination", icon: FileSpreadsheet },
        { id: "confirm", label: "Confirm", icon: BarChart3 },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-white to-white dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
            {/* Header */}
            <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
                <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                        Quick Start
                    </h1>
                    <button
                        onClick={() => router.push("/sources")}
                        className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                    >
                        Skip to dashboard →
                    </button>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-6 py-12">
                {/* Progress */}
                <div className="mb-12">
                    <div className="flex items-center justify-center gap-4">
                        {steps.map((s, i) => {
                            const Icon = s.icon;
                            const isActive = step === s.id;
                            const isPast = steps.findIndex(x => x.id === step) > i;
                            
                            return (
                                <div key={s.id} className="flex items-center">
                                    <div
                                        className={cn(
                                            "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                                            isActive
                                                ? "border-cyan-600 bg-cyan-600 text-white"
                                                : isPast
                                                    ? "border-cyan-600 bg-cyan-50 text-cyan-600 dark:bg-cyan-950/30"
                                                    : "border-gray-300 bg-white text-gray-400 dark:border-slate-700 dark:bg-slate-800"
                                        )}
                                    >
                                        {isPast ? (
                                            <CheckCircle2 className="h-5 w-5" />
                                        ) : (
                                            <Icon className="h-5 w-5" />
                                        )}
                                    </div>
                                    <span
                                        className={cn(
                                            "ml-2 text-sm font-medium",
                                            isActive
                                                ? "text-cyan-600 dark:text-cyan-400"
                                                : isPast
                                                    ? "text-gray-700 dark:text-gray-300"
                                                    : "text-gray-400 dark:text-gray-500"
                                        )}
                                    >
                                        {s.label}
                                    </span>
                                    {i < steps.length - 1 && (
                                        <div className="mx-4 h-px w-12 bg-gray-200 dark:bg-slate-700" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Step Content */}
                <div className="mx-auto max-w-2xl">
                    {step === "source" && (
                        <div className="space-y-6">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                    Where does your data come from?
                                </h2>
                                <p className="mt-2 text-gray-600 dark:text-gray-400">
                                    Select your primary e-commerce or ad platform
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                                {[
                                    { id: "shopee", name: "Shopee", category: "marketplace" },
                                    { id: "lazada", name: "Lazada", category: "marketplace" },
                                    { id: "tiktok_shop", name: "TikTok Shop", category: "marketplace" },
                                    { id: "meta_ads", name: "Meta Ads", category: "ads" },
                                    { id: "google_ads", name: "Google Ads", category: "ads" },
                                    { id: "tiktok_business", name: "TikTok Ads", category: "ads" },
                                ].map((source) => (
                                    <button
                                        key={source.id}
                                        onClick={() => handleSourceSelect(source.id)}
                                        className={cn(
                                            "flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all hover:border-cyan-300 hover:shadow-md",
                                            "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800",
                                            "hover:bg-cyan-50/50 dark:hover:bg-cyan-950/20"
                                        )}
                                    >
                                        <img
                                            src={logoPathForConnectionProvider(source.id)}
                                            alt={source.name}
                                            className="h-12 w-12 object-contain"
                                        />
                                        <div className="text-center">
                                            <p className="font-semibold text-gray-900 dark:text-white">
                                                {source.name}
                                            </p>
                                            <p className="text-xs text-gray-500 capitalize">
                                                {source.category}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === "destination" && (
                        <div className="space-y-6">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                    Where should data go?
                                </h2>
                                <p className="mt-2 text-gray-600 dark:text-gray-400">
                                    Choose where you want to analyze your data
                                </p>
                            </div>

                            <div className="space-y-3">
                                {[
                                    { 
                                        id: "google_sheets", 
                                        name: "Google Sheets", 
                                        desc: "Best for quick analysis and sharing",
                                        recommended: true 
                                    },
                                    { 
                                        id: "looker_studio", 
                                        name: "Looker Studio", 
                                        desc: "Best for dashboards and reporting",
                                        recommended: false 
                                    },
                                ].map((dest) => (
                                    <button
                                        key={dest.id}
                                        onClick={() => handleDestinationSelect(dest.id)}
                                        className={cn(
                                            "flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition-all",
                                            "border-gray-200 bg-white hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-800",
                                            dest.recommended && "border-cyan-200 bg-cyan-50/30 dark:border-cyan-800/50 dark:bg-cyan-950/20"
                                        )}
                                    >
                                        <img
                                            src={logoPathForConnectionProvider(dest.id)}
                                            alt={dest.name}
                                            className="h-10 w-10 object-contain"
                                        />
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold text-gray-900 dark:text-white">
                                                    {dest.name}
                                                </p>
                                                {dest.recommended && (
                                                    <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300">
                                                        Recommended
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                                {dest.desc}
                                            </p>
                                        </div>
                                        <ArrowRight className="h-5 w-5 text-gray-400" />
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={() => setStep("source")}
                                className="mx-auto block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
                            >
                                ← Back to source selection
                            </button>
                        </div>
                    )}

                    {step === "confirm" && (
                        <div className="space-y-6">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                    Ready to connect
                                </h2>
                                <p className="mt-2 text-gray-600 dark:text-gray-400">
                                    We'll create a pipeline that syncs automatically
                                </p>
                            </div>

                            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
                                <div className="flex items-center justify-center gap-4">
                                    {selectedSource && (
                                        <div className="flex flex-col items-center gap-2">
                                            <img
                                                src={logoPathForConnectionProvider(selectedSource)}
                                                alt=""
                                                className="h-12 w-12 object-contain"
                                            />
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                {SOURCES_CATALOG.find(s => s.id === selectedSource)?.name}
                                            </span>
                                        </div>
                                    )}
                                    
                                    <div className="flex items-center gap-1">
                                        <div className="h-px w-8 bg-gray-300 dark:bg-slate-600" />
                                        <ArrowRight className="h-4 w-4 text-gray-400" />
                                        <div className="h-px w-8 bg-gray-300 dark:bg-slate-600" />
                                    </div>
                                    
                                    {selectedDestination && (
                                        <div className="flex flex-col items-center gap-2">
                                            <img
                                                src={logoPathForConnectionProvider(selectedDestination)}
                                                alt=""
                                                className="h-12 w-12 object-contain"
                                            />
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                {selectedDestination === "google_sheets" ? "Google Sheets" : "Looker Studio"}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-6 space-y-3 rounded-lg bg-gray-50 p-4 dark:bg-slate-700/50">
                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                        <CheckCircle2 className="h-4 w-4 text-cyan-600" />
                                        <span>Syncs run automatically every 6 hours</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                        <CheckCircle2 className="h-4 w-4 text-cyan-600" />
                                        <span>First sync completes in 1-2 minutes</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                        <CheckCircle2 className="h-4 w-4 text-cyan-600" />
                                        <span>You can add more sources later</span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleConnect}
                                disabled={isConnecting}
                                className={cn(
                                    "flex w-full items-center justify-center gap-2 rounded-xl py-4 font-semibold transition-all",
                                    "bg-cyan-600 text-white hover:bg-cyan-700",
                                    "dark:bg-cyan-600 dark:hover:bg-cyan-500",
                                    isConnecting && "opacity-70 cursor-not-allowed"
                                )}
                            >
                                {isConnecting ? (
                                    <>
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        Starting connection...
                                    </>
                                ) : (
                                    <>
                                        Connect Now
                                        <ArrowRight className="h-5 w-5" />
                                    </>
                                )}
                            </button>

                            <button
                                onClick={() => setStep("destination")}
                                className="mx-auto block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
                            >
                                ← Back
                            </button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
