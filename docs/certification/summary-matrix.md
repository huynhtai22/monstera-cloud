# Advertising Connectors Certification Summary Matrix

**Status Date:** 2026-09-05  
**Evaluation Harness:** `src/lib/ad-certification/harness.ts` (v1.1.0)  
**Standard:** Strict ordered progression (`CODE_VERIFIED` → `SANDBOX_VERIFIED` → `LIVE_CONNECTED` → `LIVE_IMPORTED` → `LIVE_RECONCILED` → `DESTINATION_VERIFIED` → `RECOVERY_VERIFIED` → `PILOT_CERTIFIED`)  
**Metric Contract Version:** 1.0.0  
**Harness Contract Schema:** 20260904160000  

---

## 0. Current Live Certification Status & Deployment Governance

> [!IMPORTANT]
> **Authoritative Certification Baseline:**
> - **No connector is live-certified.**
> - **Google Ads, Meta Ads, and TikTok Ads remain strictly at `CODE_VERIFIED`.**
> - **A clean committed/deployed build is strictly required for live certification.** (Dirty-tree runs are marked `certificationEligible: false` and cannot execute live runs).
> - **The commit SHA must identify the actual deployed source state** (derived from immutable runtime build metadata, never client-supplied).
> - **The schema version must match the applied deployment migration** (`20260904160000_reporting_evidence`).
> - **The live Google run begins only after deployment verification and explicit owner authorization.**
> - **Credentials must use the deployment platform’s secret management** (AWS Secrets Manager, Google Cloud Secret Manager, or Vercel Environment Variables with production isolation).
> - **No secret may ever be pasted into Codex, Git repositories, generated reports, or chat.**

---

## 1. Provider Readiness & Certification Level

| Provider | Highest Proven Level | Controlled Pilot Status | External Access / Approval Status | Primary Blocker to Live Pilot |
|---|:---:|:---:|---|---|
| **Google Ads** | **`CODE_VERIFIED`** | ❌ **BLOCKED** | ✅ Basic Access Approved (2026-08-25). 15,000 ops/day quota. | Pending verified production OAuth client credentials and developer token in platform secret manager, and authorized customer CID. Test accounts structurally omit serving metrics. |
| **Meta Ads** | **`CODE_VERIFIED`** | ❌ **BLOCKED** | ⚠️ App Review / Live mode pending live app setup. | Pending `META_ADS_APP_ID` & `META_ADS_APP_SECRET` in platform secret manager, production OAuth consent on an active `act_*` account, and native Ads Manager reconciliation. |
| **TikTok Ads** | **`CODE_VERIFIED`** | ❌ **BLOCKED** | ⚠️ TikTok for Business Marketing API app pending. | Pending `TIKTOK_BUSINESS_APP_ID` & `SECRET` in platform secret manager, production OAuth consent on authorized numeric advertiser account, and report task polling. |

---

## 2. Gate-by-Gate Evaluation Matrix

| Certification Gate | Google Ads | Meta Ads | TikTok Ads | Rules & Acceptance Criteria |
|---|:---:|:---:|:---:|---|
| **1. CODE_VERIFIED** | ✅ **PASSED** | ✅ **PASSED** | ✅ **PASSED** | Contract v1.0.0 validated. Unit test suites passing locally. Schema mapping region-agnostic and multi-currency safe. |
| **2. SANDBOX_VERIFIED** | ⚪ **NOT_APPLICABLE** | ⚠️ **BLOCKED** | ⚠️ **BLOCKED** | Google Ads test accounts structurally omit serving metrics; Basic Access live path is the approved alternative path. Meta & TikTok blocked due to missing developer sandbox credentials in environment. |
| **3. LIVE_CONNECTED** | ⚠️ **BLOCKED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | Google Ads blocked by missing live credentials. Meta and TikTok not executed due to upstream Gate 2 block. |
| **4. LIVE_IMPORTED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | Bounded 7-day reporting window imported into `CampaignMetric` with verified continuous date coverage. |
| **5. LIVE_RECONCILED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | Native platform totals reconciled against warehouse totals under identical semantics (timezone, currency, attribution). Snapshot alignment strictly enforced. |
| **6. DESTINATION_VERIFIED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | Authenticated retrieval via Google Sheets Add-on or Looker Studio connector with current `DestinationDeliveryReceipt`. |
| **7. RECOVERY_VERIFIED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | Idempotent rerun without duplicates, token refresh lifecycle, error taxonomy, and `ProviderAccountHealth` logging. |
| **8. PILOT_CERTIFIED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | ⏸️ **NOT_EXECUTED** | Mandatory human sign-off on sanitized evidence pack. Cannot be awarded automatically or if prior mandatory gates are incomplete. |

---

## 3. Destination Delivery & Retrieval Breakdown

To prevent ambiguity regarding downstream export capabilities, delivery and retrieval readiness are tracked explicitly across all connectors:

| Dimension | Current Certification State | Reviewer Finding |
|---|:---:|---|
| **Destination Code Path** | **`CODE_VERIFIED`** | Code paths for Google Sheets Add-on (`/api/export/sheets`) and Looker Studio connector (`/api/export/looker`) pass static type checks and schema contract unit tests. |
| **Authenticated Live Retrieval** | `pending` | Requires authorized live user session retrieval against imported warehouse dataset. |
| **Current Delivery Receipt** | `pending` | `DestinationDeliveryReceipt` has not yet been minted for a live pilot dataset. |
| **Destination Certification Level** | `not reached` | Neither connector has achieved `DESTINATION_VERIFIED` status in an authorized live run. |

---

## 4. Evidence Storage & Redaction Policy

1. **Strict Git Exclusion:**
   - Synthetic fixtures (`synthetic_fixture`) may be tracked in git for deterministic regression testing.
   - Sandbox evidence (`sandbox_evidence`) and live certification evidence (`live_certification_evidence`) must **NEVER** be committed to Git.
   - The root `.gitignore` enforces exclusion of `evidence/` and all reviewer report bundles.
   - The harness programmatically refuses (`throw new Error(...)`) to persist live evidence to git-tracked repository paths.
2. **Deep Redaction:**
   - All client secrets, developer tokens, access tokens, refresh tokens, auth headers, and session cookies are deeply redacted to `"[REDACTED]"` prior to serialization.
   - Account identifiers are masked with preserved correlation suffixes (e.g. `act_***6789`, `id_***7890`).
   - Audit evidence packs record `harnessVersion`, `contractVersion`, `buildId`, `schemaVersion`, and `commitSha` for immutable provenance.

---

## 5. Human Review & Owner Action Checklist (Platform Secret Manager Protocol)

> [!CAUTION]
> **Zero Local Secrets:** Never enter live credentials, API keys, or developer tokens into `.env.local`, git repositories, or chat prompts. All live credentials must be injected exclusively via secure deployment platform secret managers (e.g., AWS Secrets Manager, Google Cloud Secret Manager, or Vercel Environment Secrets with production restriction).

Initial configuration items only enable the live certification run to begin (`LIVE_CONNECTED` / `LIVE_IMPORTED`); they do **not** award `PILOT_CERTIFIED`. Progression to `PILOT_CERTIFIED` strictly requires completing all subsequent mandatory gates:

### Step 1: Google Ads Live Advance
1. Inject `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, and `GOOGLE_ADS_CLIENT_SECRET` via the platform secret manager into an isolated staging/pilot execution environment.
2. Execute OAuth authorization flow with the approved `adwords` scope using the account owner's administrative credentials (`LIVE_CONNECTED`).
3. Select an active customer account (`CID`) that generated real ad impressions and spend within the target 7-day window.
4. Execute 7-day bounded sync (`2026-08-01` to `2026-08-07`) populating warehouse tables (`LIVE_IMPORTED`).
5. **Gate 5 (Mandatory):** Run `evaluateReconciliation` to compare warehouse metrics against Google Ads UI totals under snapshot-aligned timing context (`LIVE_RECONCILED`).
6. **Gate 6 (Mandatory):** Retrieve dataset via Google Sheets Add-on or Looker Studio connector to mint verified `DestinationDeliveryReceipt` (`DESTINATION_VERIFIED`).
7. **Gate 7 (Mandatory):** Execute duplicate sync pass to confirm idempotent deduplication (zero row duplication) and error taxonomy handling (`RECOVERY_VERIFIED`).
8. **Gate 8 (Mandatory):** Authorized platform reviewer verifies provider portal facts (developer token Basic Access approved, live account mode confirmed; API version `v23` derived from runtime connector in `src/lib/google-ads.ts`, not Google Cloud Console) and signs off on the sanitized evidence pack (`PILOT_CERTIFIED`).

### Step 2: Meta Ads Live Advance
1. Inject `META_ADS_APP_ID` and `META_ADS_APP_SECRET` via the platform secret manager into isolated staging/production.
2. Complete Meta OAuth authorization with `ads_read` and `read_insights` permissions (`LIVE_CONNECTED`).
3. Select an active ad account (`act_*`) with real delivery within the 7-day window.
4. Execute 7-day bounded sync into `CampaignMetric` (`LIVE_IMPORTED`).
5. **Gate 5 (Mandatory):** Reconcile warehouse metrics against Meta Ads Manager under identical semantics and tolerances (`LIVE_RECONCILED`).
6. **Gate 6 (Mandatory):** Mint destination delivery receipt via authenticated retrieval in Google Sheets or Looker Studio (`DESTINATION_VERIFIED`).
7. **Gate 7 (Mandatory):** Verify token refresh lifecycle and idempotent duplicate sync rerun (`RECOVERY_VERIFIED`).
8. **Gate 8 (Mandatory):** Authorized platform reviewer verifies portal facts (App Mode, Business Verification; API version `v23.0` derived from runtime connector configuration in `src/lib/meta-ads.ts` and `src/etl/connector-registry.ts`) and signs off on sanitized evidence pack (`PILOT_CERTIFIED`).

### Step 3: TikTok Ads Live Advance
1. Inject `TIKTOK_BUSINESS_APP_ID` and `TIKTOK_BUSINESS_APP_SECRET` via the platform secret manager.
2. Complete TikTok for Business Marketing API OAuth authorization.
3. Verify provider portal facts (App Approval status, API version, advertiser role).
4. Select an active numeric advertiser account.
5. Execute 7-day bounded sync, poll report tasks, and reconcile against TikTok Ads Manager.
6. Mint destination delivery receipt.
7. Verify token refresh and idempotency.
8. Sign off on sanitized evidence pack.
