# Google Ads — API access validation status & manual checklist

**Status: Google Ads API project access must be verified in Google Cloud Console — live account validation pending.**

Google retired developer-token headers on 2026-09-09. API authorization now depends on the access level of the Google Cloud project that owns the OAuth client. Project access alone does not prove OAuth correctness, metric accuracy, tenant safety, or synchronization reliability. This document captures what is verified in-repo and the remaining live-account procedure.

## Verified in-repository (2026-09-27)

- **Current request authentication**: the connector sends the user's OAuth bearer token and, for MCC requests, `login-customer-id`. It does not require or send `GOOGLE_ADS_DEVELOPER_TOKEN`.
- **Project access errors**: `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` is classified as an application-level access blocker; legacy `DEVELOPER_TOKEN_NOT_APPROVED` responses remain recognized for compatibility.
- **Micros conversion**: `cost_micros` → currency exactly once during normalization; `average_cpc`/`average_cost` (micros without the suffix) now converted as well; `ctr` untouched.
- **MCC hierarchy**: leaf discovery via `customer_client` with root MCC as `login-customer-id`; standalone accounts fall back to self-as-leaf; manager children excluded from sync targets.
- **Removed campaigns**: excluded (`campaign.status != 'REMOVED'`). Zero-impression rows follow Google defaults (excluded).
- **Partial child-account failure**: per-leaf try/catch marks failed leaves retryable without poisoning successful siblings; outcome summary drives connection state.
- Unit suite: `src/lib/google-ads.test.ts` covers normalization, current headers/login-id, batch merge, date clauses, retry matrix, project-access classification, discovery fallback, and confirms the retired token setting is ignored.

## Manual validation checklist (requires an authorized live account)

1. Connect from Sources → complete Google OAuth on a real account (expect consent screen requesting the `adwords` scope).
2. Confirm customer discovery lists the expected account(s), including under an MCC.
3. Select exactly one authorized campaign account.
4. Trigger sync with a completed 7-day window (`BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'`).
5. Verify: lease acquired → rows written to `CampaignMetric` → `lastSyncAt` advanced once → Sources/Dashboard show healthy → "Data through" equals stored `MAX(date)`.
6. Re-run the same sync → no duplicate canonical rows (deterministic upsert).
7. Reconciliation vs the Google Ads UI for identical account/dates/scope:

| Metric | Google Ads | Monstera | Abs variance | % variance | Explanation |
|---|---:|---:|---:|---:|---|
| Impressions | | | | | expect exact |
| Clicks | | | | | expect exact |
| Cost | | | | | after micros ÷1e6 + account rounding |
| Conversions | | | | | attribution delay may explain lag |
| Conversion value | | | | | column semantics |
| Campaign count | | | | | REMOVED excluded by design |

8. Only after reconciliation passes, extend the window gradually (never an unbounded backfill).

### Reconciliation context and helper

Do not compare totals copied from differently scoped reports. Record the customer ID, completed `since`/`until` range, Google Ads account timezone, currency, campaign scope (the product excludes `REMOVED` campaigns), and conversion semantics on both sides. The pure internal helper `reconcileGoogleAdsTotals` in `src/lib/google-ads-reconciliation.ts` returns a context mismatch before a variance is interpreted; it accepts only sanitized totals and makes no provider request.

For a manual pilot record, aggregate `CampaignMetric` using the same workspace, connection, account, date window, and campaign scope used by the Google report. Never include OAuth tokens or raw connection credentials in the record.

## Google Cloud project access notes

- Verify the Google Ads API access level for the Google Cloud project that owns the OAuth client. Google Ads API project access and OAuth user permissions are separate checks.
- Daily operations quotas and customer permissions still apply.
- No claim of real-time data — rolling re-sync windows apply.
- Manager-child access depends on the linking structure at authorization time.

## Error quick reference

| Failure | Class | Retry? | User action |
|---|---|---|---|
| `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | app-level blocker | no | Verify Google Ads API access for the OAuth client's Cloud project in Google Cloud Console |
| `DEVELOPER_TOKEN_NOT_APPROVED` | legacy provider response | no | Confirm the deployed connector no longer sends a developer-token header; inspect the upstream response |
| 401 / expired access token | transient auth | auto (refresh) | none |
| Revoked refresh token / `invalid_grant` | permanent auth | no | Reconnect from Sources |
| 403 permission denied on customer | account access | no | Review account access / linking |
| Invalid customer ID | config | no | Correct selected account |
| 429 / `RESOURCE_EXHAUSTED` | quota | yes (backoff) | wait for auto retry |
| Google 5xx / timeout | upstream | yes (backoff) | wait for auto retry |
| Partial leaf failures | per-account | mixed | Retry manually after fixing failing account |
