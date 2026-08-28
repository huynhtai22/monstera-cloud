# Shopee Ads Service Go Live checklist

**Authority:** This is the single readiness checklist for Monstera's Shopee Ads
Service application. Statuses mean: **READY** = repository evidence exists;
**PARTIAL** = limited evidence but an external proof remains; **MISSING** = work
is not evidenced; **MANUAL VERIFICATION REQUIRED** = an operator/reviewer must
perform it; **NOT APPLICABLE** = outside this application.

**Current verdict:** **READY WITH MANUAL STEPS.** PR #128 is merged and the
catalog migration is already applied. This does not establish Go Live approval
or a completed reviewer-accessible end-to-end demonstration.

## Technical integration

| Item | Status | Evidence / required completion |
|---|---|---|
| Correct production callback | READY | `src/lib/oauth-framework/session.ts` builds `https://monsteracloud.com/api/auth/callback?provider=shopee`; submission copy matches. |
| Explicit sandbox/production configuration | READY | `src/lib/shopee-env.ts` selects TEST pair + sandbox host or LIVE pair + production host, with no generic fallback. Operator must configure both appropriate pairs. |
| OAuth state and workspace binding | READY | `src/lib/oauth-attempt.ts` and `src/app/api/auth/callback/route.ts`. |
| Token encryption and refresh | READY | `src/lib/encryption.ts`, `src/lib/shopee-credential-utils.ts`, and provider refresh path. |
| Request signing | READY | `src/lib/shopee.ts` signs the selected environment's partner ID/key; tests cover signed authorization URLs. |
| Timeouts and retry taxonomy | READY | Provider transport retry is bounded; `src/lib/provider-error-taxonomy.test.ts` covers retryable/non-retryable outcomes. |
| Campaign pagination | READY | `v2.ads.get_product_level_campaign_id_list` pagination is covered in `src/lib/shopee-catalog.test.ts`. |
| Campaign identity ingestion | READY | PR #128 catalog sync upserts `ShopeeCampaign`, independently of performance. |
| Product pagination | READY | Catalog sync maintains `ShopeeProduct` discovery and watermark behavior. |
| Ads date-window chunking | READY | `src/lib/sync-shopee-ads-warehouse.ts` and `src/lib/shopee-catalog.test.ts` keep requests within Shopee-safe windows. |
| Idempotent warehouse writes | READY | Composite campaign identity upsert; repeated campaign `210343` test proves no duplicate. |
| Tenant isolation | READY | Workspace-scoped data model and tenant-guard coverage. |
| Partial/failed status truthfulness | READY | PR #128 source-outcome work preserves endpoint failures and does not turn zero rows into health. |
| Sanitized source sync records | READY | `ProviderSyncRun` stores endpoint outcome/request ID without token or request payload. |
| Google Sheets warehouse export | READY | Warehouse-backed Shopee Campaigns report route and membership checks exist. |
| Sandbox labelling | READY | Catalog/report records carry the sandbox environment label. |
| No buyer PII | READY | Ads/campaign/product reporting uses no buyer identity fields; submission copy declares this limitation. |

## Required authenticated proof

| Item | Status | Required evidence |
|---|---|---|
| Shopee API Tool campaign response | PARTIAL | Prior sandbox Tool evidence: shop `227420569`, campaign `210343`, `manual`. Keep the sanitized response/request ID outside source control. |
| Monstera Sandbox Sync Now | MANUAL VERIFICATION REQUIRED | Run against the connected sandbox source; no manual row insertion or pasted JSON. |
| Warehouse row | MANUAL VERIFICATION REQUIRED | Show one row for campaign `210343`, `manual`, shop `227420569`, region `VN`, **Shopee Sandbox**. |
| Idempotent second sync | MANUAL VERIFICATION REQUIRED | Repeat Sync Now and show the same single campaign identity row. |
| Honest empty performance behavior | MANUAL VERIFICATION REQUIRED | If sandbox returns no performance, show empty/unavailable—not fabricated zero metrics. |
| Google Sheets Shopee Campaigns export | MANUAL VERIFICATION REQUIRED | Show the warehouse-backed report labelled **Shopee Sandbox** with the campaign identity. |

## Reviewer package

| Item | Status | Required action |
|---|---|---|
| Exact live product URL | READY | `https://monsteracloud.com` |
| Dedicated reviewer username/password | MANUAL VERIFICATION REQUIRED | Create a non-founder account with no MFA, email-verification, payment, or phone blocker; send credentials only through Shopee's secure field. |
| Reviewer workspace | MANUAL VERIFICATION REQUIRED | Pre-create, label, and test the workspace before submission. |
| Brief Ads Service introduction | READY | `scripts/shopee-open-platform-submission.md`. |
| Three safe screenshots | MANUAL VERIFICATION REQUIRED | Sources/safe activity; Warehouse campaign identity; Sheets report. Redact all secrets. |
| Reviewer video | MANUAL VERIFICATION REQUIRED | Record the complete sequence below, unedited and redacted. |
| Test redirect domain | MANUAL VERIFICATION REQUIRED | Declare the actual registered test redirect, or state none is publicly available. |
| Live redirect domain | READY | `monsteracloud.com`, callback `/api/auth/callback?provider=shopee`. |
| Accurate IP declarations | MANUAL VERIFICATION REQUIRED | Vercel/Neon have no dedicated static egress in this setup; select **unavailable** only if that matches Shopee's form. |
| Privacy Policy | MANUAL VERIFICATION REQUIRED | Confirm the live public URL and that it describes marketplace reporting data. |
| Terms of Service | MANUAL VERIFICATION REQUIRED | Confirm the live public URL. |
| Retention/deletion explanation | MANUAL VERIFICATION REQUIRED | Provide the actual policy and deletion contact/process. |
| Non-PII declaration | READY | Submission copy states no buyer names, addresses, phone numbers, or buyer PII. |
| Support contact | MANUAL VERIFICATION REQUIRED | Provide a monitored address/contact route. |
| Step-by-step reviewer walkthrough | READY | Submission copy contains the exact safe walkthrough. |

## Recording order for Fern / Shopee reviewer

1. Sign in to the dedicated Monstera reviewer account and show its workspace.
2. Open Sources and show the Shopee connection labelled **Shopee Sandbox**.
3. Run **Sync Now** and wait for the sanitized activity record.
4. Open Warehouse and show campaign `210343`, ad type `manual`, shop `227420569`, and the sandbox label.
5. Run **Sync Now** again; refresh Warehouse and show exactly one campaign identity row.
6. Open Google Sheets **Shopee Campaigns** and show the warehouse-derived row and sandbox label.
7. If no Ads metrics are present, show the unavailable/empty performance state honestly.

## Environment operator steps

### Vercel

1. Set `SHOPEE_SANDBOX=true` plus `SHOPEE_TEST_PARTNER_ID` and
   `SHOPEE_TEST_PARTNER_KEY` only in the sandbox/test environment.
2. Set `SHOPEE_SANDBOX=false` (or omit it) plus `SHOPEE_LIVE_PARTNER_ID` and
   `SHOPEE_LIVE_PARTNER_KEY` only in Production after Go Live approval.
3. Remove/deprecate generic `SHOPEE_PARTNER_ID` and `SHOPEE_PARTNER_KEY`; code
   no longer reads them. The production callback is fixed to the documented
   unified OAuth route.
4. Do not expose values in Vercel logs, screenshots, or recordings.

### Neon

1. Do not run a manual migration for this checklist; migration
   `20260827120000_shopee_sandbox_catalog` is already applied.
2. Do not insert campaign `210343` manually. Verify it only through Sync Now.
3. If a release reports Prisma `P1002` while waiting on `pg_advisory_lock`, let
   the serialized deployment's one automatic retry run. If it fails again, wait
   for the competing release to complete, inspect migration history/drift, and
   rerun the deployment. Do not kill sessions or disable Prisma locking.
4. Any other Prisma error, failed migration, or drift signal is terminal: stop,
   investigate, and do not retry blindly.

### Shopee Open Platform

1. Register exactly `https://monsteracloud.com/api/auth/callback?provider=shopee`.
2. Use the matching test app/TEST credentials for sandbox evidence and matching
   live app/LIVE credentials only after Go Live approval.
3. Supply the reviewer package, accurate domain/IP declarations, safe screenshots,
   and the full recording. Do not submit fabricated metrics or credentials.

### Monstera reviewer account and Google Sheets

1. Create and test the dedicated reviewer account and workspace without login blockers.
2. Connect the Google Sheets add-on/report to that workspace using the approved
   OAuth configuration; use the warehouse-backed **Shopee Campaigns** report.
3. Confirm the report visibly labels sandbox data and does not convert unavailable
   performance into zero metrics.

## Rollback

If this code change must be reverted, revert its focused commit/PR and redeploy
through the normal serialized workflow. No data rollback is required because this
checklist adds no migration and does not modify production records. Do not swap
credential pairs as a rollback; restore only the prior reviewed environment
configuration after confirming the selected Shopee environment.
