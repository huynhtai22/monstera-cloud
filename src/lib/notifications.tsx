/**
 * P1: Platform-branded toast notifications
 * Clear visual feedback for multi-client agency workflows
 */

import { toast } from "sonner";
import { CheckCircle2, AlertCircle } from "lucide-react";
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
    
    toast.success(
        sourceName,
        {
            description: `${stats.rows.toLocaleString()} rows synced in ${Math.round(stats.duration)}s`,
            duration: 4000,
            icon: (
                <img 
                    src={logo} 
                    alt={provider} 
                    className="h-4 w-4 object-contain" 
                />
            ),
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
