import { safeDecrypt } from "@/lib/encryption";

/** Names created by POST /api/settings/demo-metrics (Looker / console demo seed). */
const DEMO_METRICS_SEED_NAMES = new Set([
    "Demo Meta Account",
    "Demo Google Ads Account",
    "Demo TikTok Advertiser",
]);

/**
 * Seeded “demo” source connections (empty OAuth) used for metrics demos — not real OAuth installs.
 * Hide these from Sources when the workspace is not in demo mode so App Review sees real connectors only.
 */
export function isSeededDemoSourceConnection(conn: {
    type: string;
    name: string;
    credentials: string;
}): boolean {
    if (conn.type !== "source") return false;
    if (DEMO_METRICS_SEED_NAMES.has(conn.name.trim())) return true;
    try {
        const raw = safeDecrypt(conn.credentials ?? "");
        const parsed = JSON.parse(raw) as { __monsteraDemoConnection?: boolean };
        if (parsed?.__monsteraDemoConnection === true) return true;
    } catch {
        /* ignore */
    }
    return false;
}
