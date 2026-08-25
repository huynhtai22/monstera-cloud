# Google Ads — Basic Access validation status & manual checklist

**Status: Basic Access approved (2026-08-25) — production validation pending.**

Basic Access removes the external API-access blocker. It does not by itself prove OAuth correctness, metric accuracy, tenant safety, or synchronization reliability. This document captures what is verified in-repo and the exact remaining manual procedure.

## Verified in-repository (2026-08-24)

- **Developer token handling**: consumed only server-side from `GOOGLE_ADS_DEVELOPER_TOKEN`, injected as the `developer-token` header (`src/lib/google-ads.ts` `searchStream` / `listAccessibleCustomers`). Never sent to the browser, never persisted on connections — a regression that stored it inside connection credential blobs via the OAuth adapter's `extraFields` was found and removed.
- **Error redaction**: provider responses that echo request material are scrubbed of the developer-token value before an error leaves the client (`scrubDevToken`); unit-enforced.
- **Micros conversion**: `cost_micros` → currency exactly once during normalization; `average_cpc`/`average_cost` (micros without the suffix) now converted as well; `ctr` untouched.
- **Structured approval error**: `DEVELOPER_TOKEN_NOT_APPROVED` remains a first-class, non-retried classification (other deployments/tokens may still hit it) — see `isGoogleAdsDeveloperTokenBlocked`.
- **MCC hierarchy**: leaf discovery via `customer_client` with root MCC as `login-customer-id`; standalone accounts fall back to self-as-leaf; manager children excluded from sync targets.
- **Removed campaigns**: excluded (`campaign.status != 'REMOVED'`). Zero-impression rows follow Google defaults (excluded).
- **Partial child-account failure**: per-leaf try/catch marks failed leaves retryable without poisoning successful siblings; outcome summary drives connection state.
- Unit suite: `src/lib/google-ads.test.ts` (18 cases — normalization, headers/login-id, batch merge, date clauses, retry matrix, redaction, discovery fallback).

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

## Known Basic Access notes

- Basic Access enforces daily operations quotas (fine for pilot cadences; not unlimited capacity).
- No claim of real-time data — rolling re-sync windows apply.
- Manager-child access depends on the linking structure at authorization time.

## Error quick reference

| Failure | Class | Retry? | User action |
|---|---|---|---|
| `DEVELOPER_TOKEN_NOT_APPROVED` | app-level blocker | no | Contact support / check deployment token config |
| 401 / expired access token | transient auth | auto (refresh) | none |
| Revoked refresh token / `invalid_grant` | permanent auth | no | Reconnect from Sources |
| 403 permission denied on customer | account access | no | Review account access / linking |
| Invalid customer ID | config | no | Correct selected account |
| 429 / `RESOURCE_EXHAUSTED` | quota | yes (backoff) | wait for auto retry |
| Google 5xx / timeout | upstream | yes (backoff) | wait for auto retry |
| Partial leaf failures | per-account | mixed | Retry manually after fixing failing account |
