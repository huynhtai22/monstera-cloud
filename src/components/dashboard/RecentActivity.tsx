"use client";

import Link from "next/link";
import { Clock, Loader2, AlertCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { SecondaryButton, secondaryButtonLinkClassName } from "@/components/ui/SecondaryButton";

type Pipeline = {
    id: string;
    name: string;
    status: string;
    updatedAt: string;
    logs?: Array<{ rowsSynced?: number; status?: string }>;
    sourceConnection?: { name?: string };
};

type RecentActivityProps = {
    pipelines: Pipeline[] | undefined;
    isLoading: boolean;
    error: Error | undefined;
    syncingPipelineId: string | null;
    onSync: (pipelineId: string) => void;
};

export function RecentActivity({
    pipelines,
    isLoading,
    error,
    syncingPipelineId,
    onSync,
}: RecentActivityProps) {
    return (
        <div className="flex min-h-[260px] flex-col rounded-2xl border border-white bg-white/40 p-5 shadow-sm backdrop-blur-xl dark:border-[#2f3336]/60 dark:bg-[#000000]/40 sm:p-6">
                <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                    <h2 className="text-sm font-bold text-gray-900 dark:text-white">Recent activity</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Latest events from your pipelines.</p>
                </div>
                <Link href="/reports" className={"text-xs font-semibold " + secondaryButtonLinkClassName}>
                    See all logs
                </Link>
            </div>

            <div className="stagger-list flex-1 space-y-3 overflow-y-auto pr-1">
                {isLoading ? (
                    <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                        <Loader2 className="mb-3 h-6 w-6 animate-spin text-cyan-500" />
                        <span className="text-sm text-gray-500">Loading activity…</span>
                    </div>
                ) : error ? (
                    <div className="flex h-full flex-col items-center justify-center py-10 text-center text-red-500">
                        <AlertCircle className="mb-2 h-6 w-6" />
                        <span className="text-sm">Failed to load activity feed.</span>
                    </div>
                ) : Array.isArray(pipelines) && pipelines.length > 0 ? (
                    pipelines.map((pipeline, index) => {
                        const isLast = index === pipelines.length - 1;
                        const isError = pipeline.status === "error";
                        const latestLog = pipeline.logs?.[0];

                        return (
                            <div key={pipeline.id} className={`stagger-item flex items-start space-x-3 ${isLast ? "opacity-70" : ""}`}>
                                <div className="relative mt-1 shrink-0">
                                    <div
                                        className={`h-2.5 w-2.5 rounded-full ${isError ? "bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.1)]" : "bg-cyan-500 shadow-[0_0_0_4px_rgba(6,182,212,0.15)]"}`}
                                    />
                                    {!isLast && (
                                        <div className="absolute bottom-[-10px] left-[5px] top-4 w-px bg-gray-200 dark:bg-[#1d1f23]" />
                                    )}
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-gray-900 dark:text-white">
                                        {pipeline.name} {isError ? "Failed" : "Synced"}
                                    </p>
                                    <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                                        {latestLog?.status === "error"
                                            ? `Error: ${pipeline.sourceConnection?.name} → Warehouse`
                                            : latestLog?.rowsSynced && latestLog.rowsSynced > 0
                                                ? `${latestLog.rowsSynced} rows → Warehouse`
                                                : `${pipeline.sourceConnection?.name} → Warehouse`}
                                    </p>
                                    <div className="mt-0.5 flex items-center text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">
                                        <Clock className="mr-1 h-3 w-3" />
                                        {new Date(pipeline.updatedAt).toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </div>

                                    <div className="mt-2">
                                        <SecondaryButton size="sm" aria-label={`Sync ${pipeline.name}`} onClick={() => onSync(pipeline.id)} disabled={syncingPipelineId === pipeline.id}>
                                            {syncingPipelineId === pipeline.id ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Zap className="h-3.5 w-3.5" />
                                            )}
                                            Sync now
                                        </SecondaryButton>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="flex flex-1 flex-col items-center justify-center px-2 py-10 text-center">
                        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                            No pipeline runs yet. Connect a source to see sync activity here.
                        </p>
                        <Link href="/sources" className={cn(primaryButtonLinkClassName, "text-sm")}>
                            Go to Sources
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
