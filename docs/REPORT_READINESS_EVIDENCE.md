# Reporting context, requirements and delivery evidence

2026-09-04. Additive extension of `evaluateReportReadiness` / `loadReportReadiness`; no parallel evaluator. Local implementation only. Production data and deployment are out of scope.

## Configuration

Open **Clients → Report readiness → Configure reporting evidence**, or the same control in a selected client's Performance report.

- `GET /api/reports/readiness/configuration?workspaceId=…&clientId=…`: owner/admin/member/viewer read, with server-derived `canEdit`.
- `PATCH` to that route requires owner/admin and exactly one operation:
  - `{workspaceId,clientId,requirements:{providers:["meta_ads"],destinations:["google_sheets","looker_studio"]}}`
  - `{workspaceId,clientId,override:{connectionId,accountId,timezone:"Asia/Ho_Chi_Minh",currency:"VND",reason:"Verified against the account settings"}}`
- Both arrays must be nonempty. Destinations are explicit so a client using only Sheets need not prove Looker delivery. A client requiring both must retrieve both.
- Account overrides require an existing account belonging to a source assigned to this workspace/client. Null override fields restore provider facts; null is never UTC/USD. A reason (10–500 characters) is required even when clearing overrides.
- Timezones are IANA identifiers (aliases normalized); currencies use the runtime's ISO currency catalogue. Invalid values are rejected. Provider facts are retained separately and provider refreshes cannot overwrite overrides.
- Audit actions: `reporting_requirements.updated`, `reporting_context.overridden`, `reporting_context.provider_observed`, `reporting_delivery.retrieved`. Each carries scoped resource identity and safe before/after or receipt metadata. No token, key or OAuth payload is stored in audits.
- `TIMEZONE_CONFLICT` blocks differing provider/override or account timezones. `CURRENCY_CONFLICT` blocks differing provider/override or row/account currency. `MIXED_CURRENCY` warns and prevents READY. There is no FX conversion or implicit timezone conversion.

## Provider evidence

- Meta sync refreshes ad-account `currency` and `timezone_name`; persists facts only for selected accounts, using the same account ID spelling as metric rows. Saved OAuth credential metadata alone is not verification.
- Google campaign queries include `customer.currency_code` and `customer.time_zone`; returned account facts persist per leaf customer. Zero-row campaign responses cannot establish those facts. [Google field reference](https://developers.google.com/google-ads/api/fields/v24/customer).
- TikTok sync requests advertiser-info currency/timezone by exact advertiser ID, with separate sandbox host. Missing permission/context does not abort metric import, but missing persisted evidence prevents readiness. Currency from a successful advertiser-info response can label otherwise unlabelled imported rows; a report's conflicting currency is retained and flagged. [Official TikTok SDK endpoint inventory](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/README.md).
- No production/sandbox API calls were made during implementation. Provider HTTP contract tests use synthetic responses.
- Shopee/Lazada reporting timezone is NOT inferred from shop country, UTC storage or API timestamp shape. Those accounts currently require an audited manual context verification; rows without currency require upstream import correction. Their live reporting semantics remain uncertified.

## Receipt contract

Receipts prove that the server successfully retrieved a complete client/window dataset for an authenticated destination integration. They do **not** prove browser rendering, a sheet write, a successful Google-side chart refresh, human receipt, or a client acknowledgement. HTTP transport can fail after server retrieval; this implementation does not claim a delivery acknowledgement protocol.

The receipt records workspace, client, destination, inclusive reporting window, data-through date, retrieval timestamp, row count, actor identity and a SHA-256 dataset fingerprint. No public receipt-create or browser acknowledgement endpoint exists.

Supported paths:

1. `POST /api/v1/sheets/query`: verified Google ID token plus workspace membership; add `clientId`, `start_date`, `end_date`. Produces a Sheets retrieval receipt after complete successful retrieval.
2. `GET /api/looker-studio`: authenticated workspace API key produces Looker receipts. Verified Google OAuth tokens produce Sheets or Looker receipts only when `aud` exactly identifies a distinct configured `GOOGLE_ADDON_CLIENT_ID` or `LOOKER_OAUTH_CLIENT_ID`. Existing audience allowlisting remains mandatory. Missing/ambiguous destination audience permits the existing authorized query but produces **no receipt**. Caller `destination` parameters are not trusted.

Use `clientId`, explicit dates and no provider/account/connection/campaign filter or cursor/offset. Filtered, empty, failed, truncated or paginated requests never certify full-client retrieval. Each required destination must have its own receipt for the exact window. The shared endpoint bypasses its response cache for client requests. Existing ping/schema/account-list requests never create receipts.

The repository's Sheets sidebar now accepts Client ID; Looker connector config accepts Workspace ID and Client ID. Both disable user cache reuse for client retrievals. Those Apps Script changes are **not published** by this task. On the shared endpoint, distinct destination OAuth audiences must be configured/allowlisted during a separately approved rollout.

The data query, fingerprint and receipt insert share a PostgreSQL Repeatable Read transaction. Fingerprints include actual metric contents (not just max date or row count), ingestion timestamps, source assignments, required providers/destinations and account context. Corrections, insertions, deletions, reimports and configuration changes invalidate prior proof. Unrelated tenants/windows do not. The evaluator shows `DESTINATION_STALE` until all required destinations retrieve the new evidence. Context audit timestamps are intentionally conservative: changing verification configuration requires another retrieval.

Fingerprints scan at most 10,001 metric rows/contexts/sources per client; above 10,000 the snapshot is limited and cannot verify READY or mint a receipt. Existing operational evidence is capped at 5,000. This fail-closed bound is not a scalable large-account certification solution. Configuration lists at most 500 records per evidence collection; large accounts require an operator review, not invented values.

## Database and rollout

Migration `20260904160000_reporting_evidence` is additive. Existing clients remain unconfigured, with clearly labeled inference fallback; existing rows are not backfilled with guessed context. Composite workspace/connection and workspace/client foreign keys protect the two new tables, and both participate in tenant guards. Existing data and interfaces remain available after rollback, but any rollback must preserve these additive tables and pending newer writes.

Before approved rollout: review migration and run normal deployment gates, configure distinct destination OAuth audiences, publish compatible Apps Script versions, then founder-assist a real client through configuration/import/exact-window retrieval. None of these production operations were performed here.

## Exactly what still prevents live connector certification

1. No real OAuth authorization, token refresh/revocation, account discovery or provider report was exercised. Verify live permissions, account IDs and stable field availability for Meta, Google and TikTok. Test Google manager/leaf access and TikTok metadata permissions/async report retries.
2. Reconcile actual provider totals for identical account/date/timezone/currency and attribution/conversion semantics. A daily row does not prove every campaign/account arrived, and no explicit expected-account manifest exists yet. Late attribution revisions require another import/retrieval.
3. Independently validate zero-activity days and today's incomplete data. Current coverage requires rows and never assumes absent rows mean zero. Multiple reporting timezones or currencies cannot be silently consolidated.
4. Validate Shopee/Lazada report-time boundaries, order-vs-ads revenue semantics, live Ads eligibility and normalized currency. This slice does not enable Shopee permissions or assert Ads access.
5. Publish/test the actual Sheets and Looker consumers under their distinct OAuth audiences. Confirm exact client/window retrieval in the real destination, then visually reconcile the resulting sheet/report. Server receipts are not Google-side write/render acknowledgements.
6. Load-test representative client portfolios and large datasets; bounded scans may deliberately return UNKNOWN. Define retention/cleanup for growing append-only receipt/audit tables before high-volume rollout.
7. Perform operator security review and real cross-workspace acceptance with test accounts before launch. Local tenant-isolation tests are evidence of the implementation, not proof of every live deployment configuration.

Live certification remains **not performed**. READY means the saved evidence satisfies the deterministic rules; it is not a claim of audited accounting, source reconciliation, or guaranteed delivery.
