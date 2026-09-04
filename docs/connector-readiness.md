# Connector Readiness Matrix

**Scope:** historical evidence, refreshed 2026-09-04 against `2613253` plus local security-validation changes; no new live provider certification
**Purpose:** Connector audit, configuration alias verification, and live provider proof status for the Monstera Cloud agency pilot.

---

## 1. Executive Summary

- **Tenant Safety & RBAC:** Existing scoped PostgreSQL suites pass locally. September validation adds billing, analyst tools/routes, client/export queries and portfolio coverage. This is evidence for the exercised paths, not a claim that every route or provider has been independently certified. See [security validation](./SECURITY-VALIDATION-2026-09-04.md).
- **OAuth Framework & Configuration Aliases:** Passed. Aliases for TikTok Business (`TIKTOK_BUSINESS_CLIENT_KEY` / `SECRET`) and Amazon SP-API (`AMAZON_LWA_CLIENT_ID` / `SECRET`) are registered and validated via unit tests.
- **Live Upstream Provider Proof:** Mixed. Automated code coverage is available for connector behavior. Shopee sandbox API Tool evidence has demonstrated limited upstream campaign discovery, but an authenticated Monstera sandbox → warehouse → Google Sheets workflow has not yet been recorded in a reviewer-accessible run.
- **Pilot Directive:** **Do not invite users on a "live connectors work" claim until sandbox/live provider credentials are provided and end-to-end sync runs are recorded.**

---

## 2. Connector Readiness Matrix

Historical "Certified" labels below mean code-path coverage only, **not live certification**. Pending credential/token evidence remains pending. Do not market those rows as end-to-end verified.

| Provider | ID | Pilot Scope | Config Keys & Aliases | Tenant / RBAC Guard | Live API Sandbox Proof | Notes |
|---|---|---|---|---|---|---|
| **Meta Ads** | `meta_ads` | Certified | `META_ADS_APP_ID`, `META_ADS_APP_SECRET` (or `META_APP_*`) | Verified (Session + Connection RBAC) | ⚠️ Pending Sandbox Keys | Ad accounts discovery, insights sync to `CampaignMetric`, token keepalive. |
| **Google Ads** | `google_ads` | Controlled-pilot validation pending | `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN` | Verified (Session + Connection RBAC) | ✅ **Basic Access approved 2026-08-25 — production validation pending** (see `docs/google-ads-basic-access.md`) | Customer client search, report sync to `CampaignMetric`, refresh token lifecycle. Developer token is env-only (never persisted on connections); provider-echoed errors are scrubbed of the token value; unit suite in `src/lib/google-ads.test.ts`. |
| **TikTok Business** | `tiktok_business` | Certified | `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_APP_SECRET` *(aliases: `TIKTOK_BUSINESS_CLIENT_KEY`, `TIKTOK_BUSINESS_CLIENT_SECRET`)* | Verified (Session + Connection RBAC) | ⚠️ Pending Sandbox Keys | Advertiser list retrieval, report task creation/polling to `CampaignMetric`. |
| **Shopee Open Platform Ads Service** | `shopee` | Go Live approval pending | `SHOPEE_TEST_PARTNER_ID`, `SHOPEE_TEST_PARTNER_KEY`, `SHOPEE_LIVE_PARTNER_ID`, `SHOPEE_LIVE_PARTNER_KEY`, `SHOPEE_SANDBOX` | Verified (Session + Connection RBAC) | PARTIAL — sandbox API Tool evidence; end-to-end Monstera proof still required | PR #128 added campaign/catalog identity, bounded Ads windows, truthful outcomes, and warehouse-backed Sheets. Production Ads Service access remains dependent on Shopee Go Live approval. |
| **Google Sheets** | `google_sheets` | Certified (Dest.) | `GOOGLE_ID_TOKEN_AUDIENCES` | Verified (Google ID Token Audience + RBAC) | ⚠️ Pending Test Token | Apps Script / Add-on query protocol, public schema catalog. |
| **Looker Studio** | `looker_studio` | Certified (Dest.) | Hashed Workspace API Key / Google ID Token | Verified (Workspace API Key / Token RBAC) | ⚠️ Pending Test Token | Community Connector endpoints, workspace-bound data extraction. |
| **Lazada** | `lazada` | Deferred | `LAZADA_APP_KEY`, `LAZADA_APP_SECRET` | Disabled in pilot | N/A (Deferred) | Post-pilot e-commerce catalog connector. |
| **TikTok Shop** | `tiktok_shop` | Deferred | `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET` (or `TIKTOK_APP_*`) | Disabled in pilot | N/A (Deferred) | Post-pilot marketplace order sync. |
| **Amazon SP-API** | `amazon` | Deferred | `AMAZON_CLIENT_ID`, `AMAZON_CLIENT_SECRET` *(aliases: `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`)* | Disabled in pilot | N/A (Deferred) | Post-pilot marketplace integration. |
| **Shopify** | `shopify` | Deferred | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Disabled in pilot | N/A (Deferred) | Post-pilot store connector. |

---

## 3. Automated Evidence

- `9d6f572`: durable account quarantine/reconnect state and skip logic for Meta, Google Ads and TikTok; complete-snapshot stale-row comparisons are **observability only**. September local unit/real-PG tests pass. No deletion/retention policy is enabled by these changes.
- `security-boundaries.pg.integration.test.ts`: real handler/RBAC/database checks for the newer billing, analyst, portfolio and export-input surfaces; synthetic credentials only. This is not a live provider sync test.

- `src/lib/oauth-framework/registry.test.ts`: Confirms `isProviderConfigured` correctly resolves primary and alias environment variables for `tiktok_business` and `amazon`.
- `src/lib/shopee-ads-mapper.test.ts`: Confirms Shopee ads CPC metric normalization, date parsing, breakdown hashing, and ROAS calculations.
- PR #128 (`ca141b4`) merged the Shopee sandbox warehouse-sync fix; its focused and CI evidence covers campaign discovery, idempotency, bounded Ads windows, source outcome truthfulness, and the catalog schema.
- `src/lib/tenant-isolation.pg.integration.test.ts`: Confirms that connection lookup, credential access, sync timestamps, and warehouse pipelines cannot be accessed or mutated across tenant boundaries.

---

## 4. Live Certification Requirements (Before External Agency Pilot)

Before moving any certified provider from **Pending** to **Passed** for live agency onboarding:
1. Provide active sandbox/developer credentials in `.env.local` for Meta Ads, Google Ads, TikTok Business, and Shopee.
2. Execute live OAuth consent flows and store encrypted connection records.
3. Perform an initial data sync and verify that rows populate `CampaignMetric` / `RetailOrder` tables with accurate freshness timestamps.
4. Test token refresh / renewal lifecycle for each certified connector.

For Shopee Ads Service specifically, do not mark the full workflow passed from unit tests or API Tool calls alone. The final proof is an authenticated, reviewer-accessible recording of sandbox campaign `210343` → Monstera Sync Now → one warehouse campaign identity → Google Sheets **Shopee Campaigns** export.
