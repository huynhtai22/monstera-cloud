/**
 * P1: Timezone-aware time formatting for SEA agencies
 */

/**
 * Format a sync timestamp with timezone context
 * Shows both local time and relative "ago" text
 * 
 * Example output: "14:32 SGT (2h ago)"
 */
export function formatSyncTime(
    date: Date | string | null,
    options?: {
        timezone?: string;  // e.g., 'Asia/Singapore', 'Asia/Bangkok'
        locale?: string;    // e.g., 'en-SG', 'th-TH'
    }
): string | undefined {
    if (!date) return undefined;
    
    const d = typeof date === "string" ? new Date(date) : date;
    if (!Number.isFinite(d.getTime())) return undefined;
    
    // P1: Default to Singapore time for SEA agencies
    const tz = options?.timezone || "Asia/Singapore";
    const locale = options?.locale || "en-SG";
    
    // Format local time in agency timezone
    const localTime = new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(d);
    
    // Calculate relative time
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    let agoText: string;
    if (mins < 1) agoText = "just now";
    else if (mins < 60) agoText = `${mins}m ago`;
    else if (mins < 24 * 60) agoText = `${Math.round(mins / 60)}h ago`;
    else agoText = `${Math.round(mins / (24 * 60))}d ago`;
    
    // Extract timezone abbreviation
    const tzShort = tz.split("/").pop()?.substring(0, 3).toUpperCase() || "SGT";
    
    return `${localTime} ${tzShort} (${agoText})`;
}

/**
 * Simple relative time for compact display
 * Enhanced with stale threshold awareness
 */
export function timeAgo(
    iso?: string | null,
    options?: { staleThresholdMins?: number }
): { text: string | undefined; isStale: boolean } {
    if (!iso) return { text: undefined, isStale: true };
    
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return { text: undefined, isStale: true };
    
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    const threshold = options?.staleThresholdMins || 6 * 60; // 6 hours default
    
    let text: string;
    if (mins < 1) text = "just now";
    else if (mins < 60) text = `${mins}m ago`;
    else if (mins < 24 * 60) text = `${Math.round(mins / 60)}h ago`;
    else text = `${Math.round(mins / (24 * 60))}d ago`;
    
    return { text, isStale: mins > threshold };
}
