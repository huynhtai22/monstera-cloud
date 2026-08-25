export type PublicIntegrationEntry = {
  slug: string;
  source: string;
  destination: "Google Sheets™" | "Looker Studio™";
  headline: string;
  description: string;
  availableData: readonly string[];
  requirements: readonly string[];
  limitations: readonly string[];
  keywords: readonly string[];
  faqs: readonly { question: string; answer: string }[];
};

/**
 * Public integration pages are deliberately limited to pilot-certified source
 * connectors and destinations that have a working product path in this repo.
 * Keep this list aligned with `PILOT_CERTIFIED_PROVIDERS`.
 */
export const PUBLIC_INTEGRATIONS: readonly PublicIntegrationEntry[] = [
  {
    slug: "meta-ads-to-google-sheets",
    source: "Meta Ads",
    destination: "Google Sheets™",
    headline: "Connect Meta Ads to Google Sheets",
    description:
      "Query workspace-scoped Meta campaign and ad-set reporting data from the Monstera Google Sheets add-on instead of rebuilding recurring CSV exports.",
    availableData: ["Daily spend, impressions, reach, and clicks", "Campaign and ad-set names", "Conversions, revenue, and ROAS when returned by Meta"],
    requirements: ["A Monstera workspace with Meta access enabled", "A Meta account you are authorized to report on", "The Monstera Google Sheets add-on"],
    limitations: ["Meta attribution and conversion definitions remain provider-defined", "Refreshes are on demand or nightly during the pilot"],
    keywords: ["Meta Ads Google Sheets", "Facebook ads reporting", "agency Meta reporting"],
    faqs: [
      { question: "How is pilot data refreshed?", answer: "Agency staff can refresh a selected date window on demand, and pilot operations also run a nightly warehouse refresh." },
      { question: "Does Monstera edit campaigns?", answer: "No. The reporting workflow retrieves performance data; campaign changes remain in Meta Ads Manager." },
    ],
  },
  {
    slug: "meta-ads-to-looker-studio",
    source: "Meta Ads",
    destination: "Looker Studio™",
    headline: "Connect Meta Ads to Looker Studio",
    description:
      "Use a workspace API key to report on Meta campaign data already synchronized into Monstera, with visible freshness and import outcomes in the console.",
    availableData: ["Daily campaign and ad-set performance", "Spend, impressions, clicks, and reach", "Conversions, revenue, and ROAS when returned by Meta"],
    requirements: ["A synchronized Meta Ads connection", "A workspace API key created in Monstera", "Access to the Monstera community connector"],
    limitations: ["Looker Studio reads stored warehouse data; it does not call Meta directly", "Provider attribution settings still determine conversion totals"],
    keywords: ["Meta Ads Looker Studio", "Facebook ads dashboard", "Meta reporting connector"],
    faqs: [
      { question: "Why use Looker Studio instead of only Sheets?", answer: "Looker Studio is useful for shareable dashboards; Sheets remains useful for ad-hoc modeling and client-specific workflows." },
    ],
  },
  {
    slug: "google-ads-to-google-sheets",
    source: "Google Ads",
    destination: "Google Sheets™",
    headline: "Connect Google Ads to Google Sheets",
    description:
      "Bring daily Google Ads campaign and ad-group metrics into a spreadsheet workflow through Monstera’s normalized reporting warehouse.",
    availableData: ["Campaign and ad-group names", "Spend, impressions, clicks, CTR, and CPC", "Conversions, conversion value, and currency"],
    requirements: ["A Google Ads account accessible to your Google user", "A Monstera workspace with Google Ads enabled", "The Monstera Google Sheets add-on"],
    limitations: ["Basic Access is approved; the production deployment and customer account must still be authorized for Google Ads API access", "Conversion values follow the account’s Google Ads configuration"],
    keywords: ["Google Ads Google Sheets", "Google Ads reporting export", "Google Ads spreadsheet connector"],
    faqs: [
      { question: "Can manager accounts be used?", answer: "Monstera resolves accessible leaf accounts under a manager account and reports on the selected customer accounts." },
    ],
  },
  {
    slug: "google-ads-to-looker-studio",
    source: "Google Ads",
    destination: "Looker Studio™",
    headline: "Connect Google Ads to Looker Studio",
    description:
      "Build Looker Studio reports from Google Ads metrics stored in a workspace-scoped Monstera warehouse and authenticated with a revocable API key.",
    availableData: ["Daily campaign and ad-group performance", "Spend, clicks, impressions, CTR, and CPC", "Conversions, conversion value, and currency"],
    requirements: ["At least one completed Google Ads import", "A workspace API key", "Access to the Monstera community connector"],
    limitations: ["Dashboards reflect the latest completed warehouse import", "Google Ads remains subject to customer permissions and production connector validation"],
    keywords: ["Google Ads Looker Studio", "Google Ads dashboard connector", "paid search reporting"],
    faqs: [
      { question: "Does Looker Studio call Google Ads directly?", answer: "No. It queries the normalized metrics already stored in the selected Monstera workspace." },
    ],
  },
  {
    slug: "tiktok-ads-to-google-sheets",
    source: "TikTok Ads",
    destination: "Google Sheets™",
    headline: "Connect TikTok Ads to Google Sheets",
    description:
      "Replace recurring TikTok Ads CSV exports with a workspace-scoped spreadsheet query over completed Monstera reporting imports.",
    availableData: ["Daily campaign and ad-group performance", "Spend, impressions, clicks, CTR, and CPC", "Conversions, revenue, and ROAS when returned by TikTok"],
    requirements: ["A live TikTok for Business advertiser authorization", "A Monstera workspace with TikTok Ads enabled", "The Monstera Google Sheets add-on"],
    limitations: ["Standard campaign reporting is supported; GMV Max coverage requires separate live-account validation", "TikTok report tasks must complete before rows are available"],
    keywords: ["TikTok Ads Google Sheets", "TikTok reporting automation", "TikTok spreadsheet connector"],
    faqs: [
      { question: "Does this include TikTok Shop?", answer: "No. TikTok Ads and TikTok Shop are separate products. This certified workflow covers TikTok for Business advertising reports." },
    ],
  },
  {
    slug: "tiktok-ads-to-looker-studio",
    source: "TikTok Ads",
    destination: "Looker Studio™",
    headline: "Connect TikTok Ads to Looker Studio",
    description:
      "Use Monstera’s workspace warehouse and Looker Studio connector to keep TikTok Ads reporting alongside other certified advertising sources.",
    availableData: ["Daily campaign and ad-group performance", "Spend, impressions, clicks, CTR, and CPC", "Conversions, revenue, and ROAS when available"],
    requirements: ["A completed TikTok Ads synchronization", "A workspace API key", "Access to the Monstera community connector"],
    limitations: ["The connector reads completed warehouse data rather than live Ads Manager state", "GMV Max requires separate live validation and is not promised here"],
    keywords: ["TikTok Ads Looker Studio", "TikTok marketing dashboard", "TikTok reporting connector"],
    faqs: [
      { question: "How do I verify freshness?", answer: "Check the latest completed import and metric date in Data Explorer before relying on a dashboard refresh." },
    ],
  },
  {
    slug: "shopee-to-google-sheets",
    source: "Shopee",
    destination: "Google Sheets™",
    headline: "Connect Shopee to Google Sheets",
    description:
      "Bring daily Shopee order counts and revenue rollups into a spreadsheet workflow, with advertising performance added when the shop’s Partner Center access permits it.",
    availableData: ["Daily order counts and gross revenue", "Shop and currency context", "Best-effort Shopee Ads campaign metrics when the Ads API is enabled"],
    requirements: ["A Shopee shop authorized through Open Platform", "A Monstera workspace with Shopee enabled", "The Monstera Google Sheets add-on"],
    limitations: ["Shopee Ads access depends on Partner Center approval", "Marketplace API fields can differ from Seller Center UI labels"],
    keywords: ["Shopee Google Sheets", "Shopee order reporting", "Shopee spreadsheet connector"],
    faqs: [
      { question: "Will advertising rows always be present?", answer: "No. Order rollups are the primary warehouse scope; advertising metrics are best-effort until Shopee enables the Ads API for the connected partner." },
    ],
  },
  {
    slug: "shopee-to-looker-studio",
    source: "Shopee",
    destination: "Looker Studio™",
    headline: "Connect Shopee to Looker Studio",
    description:
      "Report on synchronized Shopee order and revenue rollups in Looker Studio through a workspace API key, alongside certified advertising sources.",
    availableData: ["Daily order counts and gross revenue", "Shop and currency context", "Best-effort Shopee Ads metrics when available"],
    requirements: ["A completed Shopee warehouse import", "A workspace API key", "Access to the Monstera community connector"],
    limitations: ["Ads data is conditional on Shopee Partner Center access", "Business-critical totals should be spot-checked against Seller Center during onboarding"],
    keywords: ["Shopee Looker Studio", "Shopee dashboard connector", "marketplace reporting"],
    faqs: [
      { question: "How does data reach Looker Studio?", answer: "The connector queries metrics already stored in the selected Monstera workspace using a revocable workspace API key." },
    ],
  },
] as const;

export const PUBLIC_INTEGRATION_SLUGS = PUBLIC_INTEGRATIONS.map((entry) => entry.slug);

export function publicIntegrationBySlug(slug: string): PublicIntegrationEntry | undefined {
  return PUBLIC_INTEGRATIONS.find((entry) => entry.slug === slug);
}
