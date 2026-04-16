/**
 * Source filter chips and pipeline-name matching for Reports (and shared URL ?source=).
 * IDs align with integration catalog slugs used in the app.
 */
export const REPORTS_SOURCE_CHIPS: { id: string; label: string }[] = [
    { id: "", label: "All sources" },
    { id: "tiktok_business", label: "TikTok" },
    { id: "meta_ads", label: "Meta" },
    { id: "google_ads", label: "Google" },
    { id: "shopee", label: "Shopee" },
    { id: "shopify", label: "Shopify" },
];

export function pipelineMatchesSourceFilter(pipelineName: string, sourceId: string): boolean {
    if (!sourceId) return true;
    const n = pipelineName.toLowerCase();
    switch (sourceId) {
        case "tiktok_business":
            return n.includes("tiktok");
        case "meta_ads":
            return n.includes("meta") || n.includes("facebook");
        case "google_ads":
            return n.includes("google");
        case "shopee":
            return n.includes("shopee");
        case "shopify":
            return n.includes("shopify");
        default:
            return true;
    }
}
