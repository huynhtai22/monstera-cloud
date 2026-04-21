/**
 * P1: Platform-branded toast notifications
 * Clear visual feedback for multi-client agency workflows
 */

import { toast } from "sonner";
import { logoPathForConnectionProvider } from "./integration-logos";

interface SyncToastStats {
    rows: number;
    duration: number; // seconds
}

/**
 * Show a platform-branded toast for sync completion
 * P1: Helps agencies identify which client's sync finished when running multiple in parallel
 */
export function showSyncToast(
    provider: string,
    sourceName: string,
    stats: SyncToastStats
): void {
    const logo = logoPathForConnectionProvider(provider);
    const hasData = stats.rows > 0;
    
    toast.custom(
        (t) => (
            <div
                className={`
                    flex items-center gap-3 rounded-lg border p-3 shadow-lg
                    bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700
                    ${t.visible ? "animate-enter" : "animate-leave"}
                `}
            >
                {/* Platform logo */}
                <img
                    src={logo}
                    alt={provider}
                    className="h-6 w-6 shrink-0 object-contain"
                />
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {sourceName}
                    </p>
                    <p className="text-xs text-gray-500">
                        {stats.rows.toLocaleString()} rows • {Math.round(stats.duration)}s
                    </p>
                </div>
                
                {/* Status icon */}
                {hasData ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                ) : (
                    <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                )}
            </div>
        ),
        {
            id: `sync-${provider}-${Date.now()}`, // P1: Unique ID prevents spam
            duration: 4000,
        }
    );
}

/**
 * Show error toast with platform context
 */
export function showSyncErrorToast(
    provider: string,
    sourceName: string,
    error: string
): void {
    const logo = logoPathForConnectionProvider(provider);
    
    toast.error(
        sourceName,
        {
            description: error,
            duration: 6000,
            icon: <img src={logo} alt={provider} className="h-4 w-4 object-contain" />,
        }
    );
}

/**
 * Show pipeline creation success toast
 * P1: Explicit confirmation for the new setup flow
 */
export function showPipelineCreatedToast(
    sourceName: string,
    destinationName: string
): void {
    toast.success(
        `${sourceName} → ${destinationName}`,
        {
            description: "Data will sync automatically. View progress in Reports.",
            duration: 5000,
            action: {
                label: "View Reports",
                onClick: () => (window.location.href = "/reports"),
            },
        }
    );
}
