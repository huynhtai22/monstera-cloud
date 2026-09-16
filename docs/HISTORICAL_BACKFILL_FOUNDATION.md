# Historical Backfill Foundation

This document records the evidence behind the planning-only provider policy in `src/lib/historical-ingestion-capabilities.ts`. It does not expose a customer action or authorize a long-running import. Provider availability, Monstera product selection, request chunking, and retention of rows already in the Warehouse are separate concerns.

## Production evidence audit (2026-09-16)

| Connector | Production sync entry point | Date handling and pagination | Current safe span / main failure mode | Ingestion readiness |
| --- | --- | --- | --- | --- |
| Meta Ads | `syncConnectionData` → `syncMetaAds` | Explicit values become Insights `time_range`; cursor pages, 500-row page size, 500,000 in-memory guard | New OAuth connections queue the approved 90-day window as three newest-first 30-day internal-safety slices. Generic Meta ranges over 30 days fail closed until the resumable dispatcher exists. | Limited |
| Google Ads | `syncConnectionData` → `syncGoogleAds` | GAQL `BETWEEN` date values; SearchStream is collected in memory | New OAuth connections queue the approved 90-day window as three newest-first 30-day internal-safety slices. Daily/granular reporting has a verified 37-month provider ceiling; generic Google ranges over 30 days fail closed. | Limited |
| TikTok Ads (`tiktok_business`) | `syncConnectionData` → `syncTikTok` | Values pass to an async report task; sandbox has page/total-page pagination and production downloads one file | Current default is 30 days. Provider historical allowance is application/account-specific and unverified here. | Limited |
| Shopee Orders | `syncConnectionData` → `syncShopeeWarehouseMetrics` | UTC date range is split into order-list windows; cursor pages and order-detail batches | Existing code uses roughly 14-day windows, but the provider limit needs current primary-source verification. Boundary overlap and whole-operation failures remain risks. | Limited |
| Shopee Ads | Runs under the `shopee` connection after orders | 28-day date chunks, campaign ID pages | Best-effort only; Partner Center access failures can intentionally produce zero rows without failing the order import. No advertised historical range. | Limited |
| Lazada | `syncConnectionData` → `syncLazadaWarehouseMetrics` | Order creation dates; offset pages of 100 | Existing rolling default is 30 days. Offset safety stop can truncate; provider history limit is unverified. | Limited |
| Amazon SP | No `syncConnectionData` Warehouse branch | OAuth/client exists, extractor is a placeholder | No CampaignMetric ingestion worker. | Unavailable |
| Shopify | No `syncConnectionData` Warehouse branch | Existing client fetches one orders page; extractor is a placeholder | No CampaignMetric ingestion worker. Provider order scopes do not make Warehouse ingestion available. | Unavailable |

The detailed implementation references are `src/lib/sync-connection.ts`, `src/lib/meta-ads.ts`, `src/lib/google-ads.ts`, `src/lib/tiktok-business.ts`, `src/lib/sync-marketplace-warehouse.ts`, `src/lib/sync-shopee-ads-warehouse.ts`, `src/lib/lazada.ts`, `src/lib/amazon-sp.ts`, and `src/lib/shopify.ts`.

## Persistence and execution evidence

- `CampaignMetric.rawData` is nullable. Existing indexes include `[workspaceId, platform, date]`, `[connectionId, date]`, `[workspaceId, accountId, date]`, and the idempotency unique key in `prisma/schema.prisma`; no duplicate index is needed.
- No retention/pruning worker deletes Warehouse metrics. `connector-runtime/retention.ts` explicitly excludes them. The 731-day retention value in the capability module is a product target, not an enabled purge policy.
- `SyncCheckpoint` belongs to the ETL runner, not Warehouse imports. Warehouse uses `WarehouseImportJob` leases, idempotency keys, and `queued`/`running`/`completed`/`partial`/`failed` states.
- The current batch route has generic product clamping and only regex date validation. The new planner deliberately consumes `getCanonicalDateRange` instead and does not change that existing route boundary in this phase.
- Account normalization remains provider-specific: Meta-only `act_` equivalence is contained in Meta scopes; Google, TikTok, Shopee, and Lazada do not inherit it.

## Source provenance

Only verified provider claims have primary-source URLs in the canonical module. Accessed 2026-09-16:

- [Google Ads API — Zero metrics](https://developers.google.com/google-ads/api/docs/reporting/zero-metrics): granular data retention is 37 months and older granular requests return a date-range error.
- [Google Ads API — Date ranges](https://developers.google.com/google-ads/api/docs/query/date-ranges): custom GAQL date syntax.
- [Meta Marketing API — Ads Insights](https://developers.facebook.com/docs/marketing-api/insights): identifies the reporting surface, but does not verify a general daily-history ceiling for the current Warehouse metric set.
- [Shopify Admin API — Order](https://shopify.dev/docs/api/admin-rest/unstable/resources/order): default 60-day order access and the `read_all_orders` requirement. This does not change Shopify's unavailable Warehouse status.

TikTok, Shopee, Shopee Ads, and Lazada range claims remain explicitly unverified until a current primary provider source is recorded. The planner can certify deterministic boundaries for QA, but its execution guard rejects extended execution when verification is not sufficient. Meta and Google two-year ranges are planning-only: no route or UI action is added, and the capability status retains the async/chunked-worker blocker.
