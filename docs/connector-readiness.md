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

- Report Readiness adds a client/window advisory check over account health, imports, daily coverage, persisted account context, explicit client requirements and authenticated destination receipts. See [semantics](./REPORT_READINESS.md) and [exact remaining live-certification gaps](./REPORT_READINESS_EVIDENCE.md). Real READY requires all evidence to pass; local fixture success is not live connector certification.

- `9d6f572`: durable account quarantine/reconnect state and skip logic for Meta, Google Ads and TikTok; complete-snapshot stale-row comparisons are **observability only**. September local unit/real-PG tests pass. No deletion/retention policy is enabled by these changes.
- `security-boundaries.pg.integration.test.ts`: real handler/RBAC/database checks for the newer billing, analyst, portfolio and export-input surfaces; synthetic credentials only. This is not a live provider sync test.

- `src/lib/oauth-framework/registry.test.ts`: Confirms `isProviderConfigured` correctly resolves primary and alias environment variables for `tiktok_business` and `amazon`.
- `src/lib/shopee-ads-mapper.test.ts`: Confirms Shopee ads CPC metric normalization, date parsing, breakdown hashing, and ROAS calculations.
- PR #128 (`ca141b4`) merged the Shopee sandbox warehouse-sync fix; its focused and CI evidence covers campaign discovery, idempotency, bounded Ads windows, source outcome truthfulness, and the catalog schema.
- `src/lib/ad-certification/harness.ts`: Standardized 8-tier live certification harness (`CODE_VERIFIED` to `PILOT_CERTIFIED`), metric contracts v1.0.0, zero-leakage redaction, and deterministic reconciliation. All three advertising connectors (Google Ads, Meta Ads, TikTok Ads) are currently **`CODE_VERIFIED`** and blocked from live pilot claims pending live credentials, real OAuth connection, and native comparison reconciliation. See [summary matrix](./certification/summary-matrix.md).
- `src/lib/tenant-isolation.pg.integration.test.ts`: Confirms that connection lookup, credential access, sync timestamps, and warehouse pipelines cannot be accessed or mutated across tenant boundaries.

---

## 4. Live Certification Requirements & Ordered Progression

> [!IMPORTANT]
> **Governance & Verification Rules for Live Certification:**
> - **No connector is currently live-certified.** Google Ads, Meta Ads, and TikTok Ads connectors remain at **`CODE_VERIFIED`**.
> - **Clean Deployed Build Required:** A clean, committed, and deployed build is strictly required for live certification runs. Dirty working tree runs are marked `certificationEligible: false` and cannot execute live certification.
> - **Immutable Traceability:** The commit SHA must identify the actual deployed source state, and schema version must match the applied deployment migration (`20260904160000_reporting_evidence`). Client-provided SHAs or schema versions are never trusted.
> - **Owner Authorization:** The live Google Ads run begins only after deployment verification and explicit owner authorization.
> - **Platform Secret Management:** Provider credentials must be injected exclusively via deployment platform secret management (never `.env.local`, Git, or chat). No secrets may be pasted into Codex, Git, reports, or chat.

The initial setup items below only enable the live run to begin (`LIVE_CONNECTED` / `LIVE_IMPORTED`); **they do not award `PILOT_CERTIFIED`**:
1. Configure verified provider application credentials via deployment platform secret manager (never `.env.local` or chat).
2. Complete live OAuth consent on an authorized account with real advertising history.
3. Perform a bounded initial data sync populating `CampaignMetric` / `RetailOrder` tables.
4. Verify token lifecycle and encrypted credential persistence.

Progression to **`PILOT_CERTIFIED`** strictly requires completing all subsequent mandatory gates:
- **Gate 5: `LIVE_RECONCILED`** — Native platform totals reconciled against warehouse totals under identical semantics (timezone, currency, attribution) with strict snapshot alignment.
- **Gate 6: `DESTINATION_VERIFIED`** — Authenticated retrieval via Google Sheets Add-on or Looker Studio connector with verified `DestinationDeliveryReceipt`.
- **Gate 7: `RECOVERY_VERIFIED`** — Idempotent duplicate sync pass confirming zero row duplication and valid error taxonomy handling.
- **Gate 8: `PILOT_CERTIFIED`** — Formal human review and sign-off on the sanitized evidence pack by an authorized platform lead.

For Shopee Ads Service specifically, do not mark the full workflow passed from unit tests or API Tool calls alone. The final proof is an authenticated, reviewer-accessible recording of sandbox campaign `210343` → Monstera Sync Now → one warehouse campaign identity → Google Sheets **Shopee Campaigns** export.

