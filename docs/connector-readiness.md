# Connector Readiness Matrix

**Scope:** branch `feat/harden-reliability-security-release`  
**Purpose:** Connector audit, configuration alias verification, and live provider proof status for the Monstera Cloud agency pilot.

---

## 1. Executive Summary

- **Tenant Safety & RBAC:** Passed and enforced across all connector lookup, account discovery, credential encryption, and warehouse sync paths (verified via PostgreSQL integration test suite).
- **OAuth Framework & Configuration Aliases:** Passed. Aliases for TikTok Business (`TIKTOK_BUSINESS_CLIENT_KEY` / `SECRET`) and Amazon SP-API (`AMAZON_LWA_CLIENT_ID` / `SECRET`) are registered and validated via unit tests.
- **Live Upstream Provider Proof:** **Pending**. Live API requests against Meta, Google Ads, TikTok, and Shopee sandboxes require active provider credentials in `.env` / secret store and have not been executed in this environment.
- **Pilot Directive:** **Do not invite users on a "live connectors work" claim until sandbox/live provider credentials are provided and end-to-end sync runs are recorded.**

---

## 2. Connector Readiness Matrix

| Provider | ID | Pilot Scope | Config Keys & Aliases | Tenant / RBAC Guard | Live API Sandbox Proof | Notes |
|---|---|---|---|---|---|---|
| **Meta Ads** | `meta_ads` | Certified | `META_ADS_APP_ID`, `META_ADS_APP_SECRET` (or `META_APP_*`) | Verified (Session + Connection RBAC) | ⚠️ Pending Sandbox Keys | Ad accounts discovery, insights sync to `CampaignMetric`, token keepalive. |
| **Google Ads** | `google_ads` | Controlled-pilot validation pending | `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN` | Verified (Session + Connection RBAC) | ✅ **Basic Access approved 2026-08-25 — production validation pending** (see `docs/google-ads-basic-access.md`) | Customer client search, report sync to `CampaignMetric`, refresh token lifecycle. Developer token is env-only (never persisted on connections); provider-echoed errors are scrubbed of the token value; unit suite in `src/lib/google-ads.test.ts`. |
| **TikTok Business** | `tiktok_business` | Certified | `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_APP_SECRET` *(aliases: `TIKTOK_BUSINESS_CLIENT_KEY`, `TIKTOK_BUSINESS_CLIENT_SECRET`)* | Verified (Session + Connection RBAC) | ⚠️ Pending Sandbox Keys | Advertiser list retrieval, report task creation/polling to `CampaignMetric`. |
| **Shopee Open Platform** | `shopee` | Certified | `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SANDBOX` | Verified (Session + Connection RBAC) | ⚠️ Pending Sandbox Keys | V2 Ads CPC warehouse sync (`CampaignMetric`), orders rollup (`RetailOrder`), webhook HMAC check. |
| **Google Sheets** | `google_sheets` | Certified (Dest.) | `GOOGLE_ID_TOKEN_AUDIENCES` | Verified (Google ID Token Audience + RBAC) | ⚠️ Pending Test Token | Apps Script / Add-on query protocol, public schema catalog. |
| **Looker Studio** | `looker_studio` | Certified (Dest.) | Hashed Workspace API Key / Google ID Token | Verified (Workspace API Key / Token RBAC) | ⚠️ Pending Test Token | Community Connector endpoints, workspace-bound data extraction. |
| **Lazada** | `lazada` | Deferred | `LAZADA_APP_KEY`, `LAZADA_APP_SECRET` | Disabled in pilot | N/A (Deferred) | Post-pilot e-commerce catalog connector. |
| **TikTok Shop** | `tiktok_shop` | Deferred | `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET` (or `TIKTOK_APP_*`) | Disabled in pilot | N/A (Deferred) | Post-pilot marketplace order sync. |
| **Amazon SP-API** | `amazon` | Deferred | `AMAZON_CLIENT_ID`, `AMAZON_CLIENT_SECRET` *(aliases: `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`)* | Disabled in pilot | N/A (Deferred) | Post-pilot marketplace integration. |
| **Shopify** | `shopify` | Deferred | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Disabled in pilot | N/A (Deferred) | Post-pilot store connector. |

---

## 3. Automated Evidence

- `src/lib/oauth-framework/registry.test.ts`: Confirms `isProviderConfigured` correctly resolves primary and alias environment variables for `tiktok_business` and `amazon`.
- `src/lib/shopee-ads-mapper.test.ts`: Confirms Shopee ads CPC metric normalization, date parsing, breakdown hashing, and ROAS calculations.
- `src/lib/tenant-isolation.pg.integration.test.ts`: Confirms that connection lookup, credential access, sync timestamps, and warehouse pipelines cannot be accessed or mutated across tenant boundaries.

---

## 4. Live Certification Requirements (Before External Agency Pilot)

Before moving any certified provider from **Pending** to **Passed** for live agency onboarding:
1. Provide active sandbox/developer credentials in `.env.local` for Meta Ads, Google Ads, TikTok Business, and Shopee.
2. Execute live OAuth consent flows and store encrypted connection records.
3. Perform an initial data sync and verify that rows populate `CampaignMetric` / `RetailOrder` tables with accurate freshness timestamps.
4. Test token refresh / renewal lifecycle for each certified connector.
