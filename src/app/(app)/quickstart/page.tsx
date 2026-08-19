"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
    const [selectedDestination, setSelectedDestination] = useState<string | null>("addon_sheets");
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
        } catch {
            toast.error("Failed to start connection. Please try again.");
            setIsConnecting(false);
        }
    }, [selectedSource]);

    const steps = [
        { id: "source", label: "Source", icon: Store },
        { id: "destination", label: "Destination", icon: FileSpreadsheet },
        { id: "confirm", label: "Confirm", icon: BarChart3 },
    ];

    return (
        <div className="min-h-screen bg-canvas">
            {/* Header */}
            <header className="border-b border-line bg-panel">
                <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
                    <h1 className="text-sm font-bold text-ink">
                        Quick Start
                    </h1>
                    <button
                        onClick={() => router.push("/sources")}
                        className="text-xs text-ink-mute hover:text-white transition-colors"
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
                                            "flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
                                            isActive
                                                ? "border-white bg-white text-black font-semibold"
                                                : isPast
                                                    ? "border-line bg-panel text-white"
                                                    : "border-line bg-canvas text-ink-mute"
                                        )}
                                    >
                                        {isPast ? (
                                            <CheckCircle2 className="h-4 w-4" />
                                        ) : (
                                            <Icon className="h-4 w-4" />
                                        )}
                                    </div>
                                    <span
                                        className={cn(
                                            "ml-2 text-xs font-semibold",
                                            isActive
                                                ? "text-white"
                                                : isPast
                                                    ? "text-ink"
                                                    : "text-ink-mute"
                                        )}
                                    >
                                        {s.label}
                                    </span>
                                    {i < steps.length - 1 && (
                                        <div className="mx-4 h-px w-12 bg-line" />
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
                                <h2 className="text-xl font-bold text-ink">
                                    Where does your data come from?
                                </h2>
                                <p className="mt-1 text-xs text-ink-mute">
                                    Select your primary e-commerce or ad platform
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                                {[
                                    { id: "meta_ads", name: "Meta Ads", category: "ads" },
                                    { id: "google_ads", name: "Google Ads", category: "ads" },
                                    { id: "tiktok_business", name: "TikTok Ads", category: "ads" },
                                    { id: "shopee", name: "Shopee", category: "marketplace" },
                                ].map((source) => (
                                    <button
                                        key={source.id}
                                        onClick={() => handleSourceSelect(source.id)}
                                        className={cn(
                                            "flex flex-col items-center gap-3 rounded-lg border p-5 transition-all hover:border-white/40 shadow-xs",
                                            "border-line bg-panel",
                                            "hover:bg-white/[0.04]"
                                        )}
                                    >
                                        <Image
                                            src={logoPathForConnectionProvider(source.id)}
                                            alt={source.name}
                                            width={40}
                                            height={40}
                                            className="h-10 w-10 object-contain"
                                        />
                                        <div className="text-center">
                                            <p className="text-xs font-semibold text-ink">
                                                {source.name}
                                            </p>
                                            <p className="text-[10px] text-ink-mute capitalize">
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
                                <h2 className="text-xl font-bold text-ink">
                                    Where should data go?
                                </h2>
                                <p className="mt-1 text-xs text-ink-mute">
                                    Choose where you want to analyze your data
                                </p>
                            </div>

                            <div className="space-y-3">
                                {[
                                    { 
                                        id: "addon_sheets", 
                                        name: "Google Sheets Add-on", 
                                        desc: "Query warehouse metrics on-demand in Google Sheets",
                                        recommended: true,
                                        disabled: false
                                    },
                                    { 
                                        id: "looker_studio", 
                                        name: "Looker Studio Connector", 
                                        desc: "Connect directly to Looker Studio using your Workspace API key",
                                        recommended: false,
                                        disabled: false
                                    },
                                    { 
                                        id: "google_sheets_scheduled", 
                                        name: "Scheduled Spreadsheet Delivery", 
                                        desc: "Automated background sync to Google Sheets (Coming soon — not available in pilot)",
                                        recommended: false,
                                        disabled: true
                                    },
                                ].map((dest) => (
                                    <button
                                        key={dest.id}
                                        disabled={dest.disabled}
                                        onClick={() => !dest.disabled && handleDestinationSelect(dest.id)}
                                        className={cn(
                                            "flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-all",
                                            dest.disabled
                                                ? "border-line/40 bg-canvas opacity-50 cursor-not-allowed"
                                                : "border-line bg-panel hover:border-white/40",
                                            dest.recommended && "border-white/30"
                                        )}
                                    >
                                        <Image
                                            src={logoPathForConnectionProvider(dest.id === "looker_studio" ? "looker_studio" : "google_sheets")}
                                            alt={dest.name}
                                            width={36}
                                            height={36}
                                            className="h-9 w-9 object-contain"
                                        />
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="text-xs font-semibold text-ink">
                                                    {dest.name}
                                                </p>
                                                {dest.recommended && (
                                                    <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] font-semibold text-white">
                                                        Recommended
                                                    </span>
                                                )}
                                                {dest.disabled && (
                                                    <span className="rounded-full border border-line/40 bg-canvas px-2 py-0.5 text-[10px] font-medium text-ink-mute">
                                                        Coming soon
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-ink-mute mt-0.5">
                                                {dest.desc}
                                            </p>
                                        </div>
                                        <ArrowRight className="h-4 w-4 text-ink-mute" />
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={() => setStep("source")}
                                className="mx-auto block text-xs text-ink-mute hover:text-white transition-colors"
                            >
                                ← Back to source selection
                            </button>
                        </div>
                    )}

                    {step === "confirm" && (
                        <div className="space-y-6">
                            <div className="text-center">
                                <h2 className="text-xl font-bold text-ink">
                                    Ready to connect
                                </h2>
                                <p className="mt-1 text-xs text-ink-mute">
                                    Connect your marketing source and start pulling normalized metrics into your warehouse
                                </p>
                            </div>

                            <div className="rounded-lg border border-line bg-panel p-6 shadow-xs">
                                <div className="flex items-center justify-center gap-4">
                                    {selectedSource && (
                                        <div className="flex flex-col items-center gap-2">
                                            <Image
                                                src={logoPathForConnectionProvider(selectedSource)}
                                                alt=""
                                                width={40}
                                                height={40}
                                                className="h-10 w-10 object-contain"
                                            />
                                            <span className="text-xs font-medium text-ink">
                                                {SOURCES_CATALOG.find(s => s.id === selectedSource)?.name}
                                            </span>
                                        </div>
                                    )}
                                    
                                    <div className="flex items-center gap-1">
                                        <div className="h-px w-8 bg-line" />
                                        <ArrowRight className="h-3.5 w-3.5 text-ink-mute" />
                                        <div className="h-px w-8 bg-line" />
                                    </div>
                                    
                                    {selectedDestination && (
                                        <div className="flex flex-col items-center gap-2">
                                            <Image
                                                src={logoPathForConnectionProvider(selectedDestination === "looker_studio" ? "looker_studio" : "google_sheets")}
                                                alt=""
                                                width={40}
                                                height={40}
                                                className="h-10 w-10 object-contain"
                                            />
                                            <span className="text-xs font-medium text-ink">
                                                {selectedDestination === "looker_studio"
                                                    ? "Looker Studio"
                                                    : "Google Sheets Add-on"}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-6 space-y-2.5 rounded-md border border-line bg-canvas p-4">
                                    <div className="flex items-center gap-2 text-xs text-ink-mute">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-white shrink-0" />
                                        <span>Data normalized and stored in your private Monstera warehouse</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-ink-mute">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-white shrink-0" />
                                        <span>First data sync completes in 1-2 minutes</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-ink-mute">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-white shrink-0" />
                                        <span>Connect unlimited accounts across certified channels</span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleConnect}
                                disabled={isConnecting}
                                className={cn(
                                    "flex w-full items-center justify-center gap-2 rounded-md py-3 font-semibold text-xs transition-colors shadow-xs",
                                    "bg-white text-black hover:bg-neutral-200",
                                    isConnecting && "opacity-70 cursor-not-allowed"
                                )}
                            >
                                {isConnecting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                        Starting connection...
                                    </>
                                ) : (
                                    <>
                                        Connect Now
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </button>

                            <button
                                onClick={() => setStep("destination")}
                                className="mx-auto block text-xs text-ink-mute hover:text-white transition-colors"
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
