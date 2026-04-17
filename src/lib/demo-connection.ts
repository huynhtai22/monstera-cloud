import { safeDecrypt } from "@/lib/encryption";

/** Names created by POST /api/settings/demo-metrics (Looker / console demo seed). */
const DEMO_METRICS_SEED_NAMES = new Set([
    "Demo Meta Account",
    "Demo Google Ads Account",
    "Demo TikTok Advertiser",
]);

/** TikTok test display names (manual sandbox-connect or internal QA). */
const TIKTOK_NON_PRODUCTION_NAMES = new Set(["monstera sandbox"]);

/**
 * Demo seeds, TikTok sandbox API tokens, and other non-production test sources.
 * Hidden from GET /api/workspaces when workspace.demoMockMode is false so Sources
 * shows real OAuth connectors only.
 */
export function isSeededDemoSourceConnection(conn: {
    type: string;
    name: string;
    provider: string;
    credentials: string;
}): boolean {
    if (conn.type !== "source") return false;
    const nameNorm = conn.name.trim().toLowerCase();
    if (DEMO_METRICS_SEED_NAMES.has(conn.name.trim())) return true;
    if (conn.provider === "tiktok_business" && TIKTOK_NON_PRODUCTION_NAMES.has(nameNorm)) return true;
    if (conn.provider === "tiktok_business" && /\bsandbox\b/i.test(conn.name)) return true;

    try {
        const raw = safeDecrypt(conn.credentials ?? "");
        const parsed = JSON.parse(raw) as { __monsteraDemoConnection?: boolean; sandbox?: boolean };
        if (parsed?.__monsteraDemoConnection === true) return true;
        if (conn.provider === "tiktok_business" && parsed?.sandbox === true) return true;
    } catch {
        /* ignore */
    }
    return false;
}
