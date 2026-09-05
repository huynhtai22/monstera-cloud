# Report Readiness — shared evaluator and persisted evidence

Report Readiness is a deterministic, advisory check of saved evidence for one **workspace client and inclusive reporting window**. Clients are organizational groups, not security tenants. This feature does not initiate synchronization, contact a provider, send a report, or change source data.

## Decision table

Precedence is **NOT_READY → UNKNOWN → WARNING → READY**.

| Status | Meaning |
| --- | --- |
| READY | Every required provider is represented, source/account health is acceptable, each observed account has rows for every requested date, no unresolved failed/partial outcome exists, currency and timezone are known, and destination evidence is verified. |
| NOT_READY | At least one definite blocker: missing/disconnected/reconnect/quarantined source, failed/partial import, stale success, missing account dates, or unavailable configured destination. Other unknowns remain in warnings. |
| UNKNOWN | No definite blocker, but essential evidence is missing: synchronization evidence, currency, timezone, or a query exceeded the evidence cap. |
| WARNING | Available data appears usable, but scope is inferred, delivery is unverified, currencies differ, or an import is running. This is not permission to deliver automatically. |

**Persisted evidence now allows a real dataset to become READY**, only after explicit client requirements, verified per-account context, source health and full date coverage, and current receipts for every required destination pass. See [configuration, receipt semantics and remaining certification gaps](./REPORT_READINESS_EVIDENCE.md). No live connector has been certified by local tests.

## Scope and evidence

- Required providers come from the owner's/admin's explicit client configuration. Unconfigured clients retain assigned-source inference, clearly labeled `REQUIRED_PROVIDERS_INFERRED`, and cannot become READY. This is a provider manifest, not a complete expected-account/campaign inventory.
- `Connection.status`, `lastError` (internal only) and `lastSyncAt` are resolved through `resolveSourceHealthState`. A `[partial]` diagnostic is distinct from generic failure.
- `ProviderAccountHealth` contributes reconnect-required, quarantine, degraded state and last-success timestamps. Fresh sibling accounts do not clear stale or failing accounts.
- `WarehouseImportJob.items/results` contribute per-connection/account outcomes for overlapping windows. Child failures override top-level success. A later success only supersedes the same target when it covers the entire requested window; a narrower retry cannot clear an older failure for the remaining dates. Untargeted and targeted imports remain separate evidence scopes.
- `ProviderSyncRun` contributes the latest outcome per endpoint. A successful endpoint cannot mask a failed sibling endpoint. Endpoint outcomes are conservative because they do not carry reporting-window coverage.
- `CampaignMetric` is grouped by connection/account/date/currency. This checks **every stored account-date**, not merely `MAX(date)`. The latest warehouse date is derived separately from actual rows, never inferred from the last sync clock. It can lie outside the selected window.
- Success freshness uses the existing **24-hour** threshold. The newest recorded success is shown, but stale connection/account evidence independently blocks readiness. A recent successful sibling does not imply full-source success.
- Currency comes only from normalized metric rows. Any null/blank/malformed currency produces `CURRENCY_UNKNOWN`; multiple known currencies produce `MIXED_CURRENCY`. No USD fallback or conversion.
- Timezone and account currency require persisted provider facts or an audited manual override. UTC storage, browser locale, location and decrypted credentials are never evidence. Missing context remains unknown; provider/override disagreements or metric/account currency conflicts block. Different account timezones block; mixed currencies warn and never produce READY.
- Client-linked destination connections and pipelines establish configuration/availability only. Actual authenticated client/window retrievals produce receipts. Every explicitly required destination must have a current receipt; mismatched dataset fingerprints yield `DESTINATION_STALE`. API-key existence/last-used timestamps, report schedules and connection existence never prove delivery.

## API and operational behavior

`GET /api/reports/readiness?workspaceId=…&clientId=…&start=YYYY-MM-DD&end=YYYY-MM-DD` returns `{ evaluation }` computed from the latest saved evidence.

Omit `clientId` for `{ evaluations, nextCursor }`: clients sorted by ID, default/max page size 50. Use `after=nextCursor` for the next page; `limit` accepts 1–50. The Clients UI offers “Evaluate next 50 clients.” A client outside loaded pages is explicitly unevaluated, not green.

`POST /api/reports/readiness` takes `{ workspaceId, clientId, start?, end? }` and re-evaluates without writing. It requires member or higher, consistent with explicit client actions. GET requires viewer or higher. Signed-out users receive 401; nonmembers 403 (missing workspace 404); foreign/missing client IDs 404. Unsupported browser assertions such as `status`, `timezone` or `destination` are rejected, not trusted.

Dates must be valid calendar dates, both supplied or both omitted, ordered, inclusive, no future date, at most 90 days. Default is **seven completed UTC date labels through yesterday**. The selected-client Performance report passes its actual displayed preset (which may include today); readiness does not silently change that window.

Responses use `private, no-store`. The browser keys data by workspace/client/window, clears old badges on revalidation, shows loading/error states, and never displays stale success after an error. No client-side decision reimplementation. The legacy client-scoped `/api/workspaces/[id]/readiness`/analyst adapter uses the same evaluator while preserving its older response shape. Legacy workspace-wide readiness remains a different, coarse operational summary; it is not client report certification.

### Additive database migration

Migration `20260904160000_reporting_evidence` adds client requirements, `AccountReportingContext` and `DestinationDeliveryReceipt`, with composite workspace/parent foreign keys. Evaluations remain derived on demand in Repeatable Read, not stored historical decisions. Dataset fingerprints include scoped row values/identities/ingestion clocks, account context and requirements. Late corrections, deletions and configuration changes invalidate earlier receipts. The API never serializes raw metric payloads, credentials or provider error bodies.

For bounded work, operational evidence has a 5,000-record/group cap and each client dataset fingerprint a 10,000-row cap, plus sentinels. Hitting either adds `EVIDENCE_LIMIT_REACHED` and prevents READY. Evaluation transactions time out after 15 seconds; retrieval transactions after 20 seconds. There is no provider fallback. Truncated coverage does not assert missing dates from an incomplete scan. Real failures still block. Equal-timestamp sync outcomes prefer failure.

## Recovery guide

| Code | Operator action |
| --- | --- |
| SOURCE_MISSING | Assign the correct sources to this client in Sources. Confirm the expected provider/account roster manually. |
| SOURCE_DISCONNECTED / SOURCE_RECONNECT_REQUIRED | Use the existing source authorization flow, then import and re-evaluate. |
| SOURCE_QUARANTINED | Review provider/account permissions and the failure with an operator; no automatic unquarantine here. |
| SYNC_FAILED / SYNC_PARTIAL | Inspect source detail/Sync activity and recover the failed targets for the whole window. |
| DATA_STALE | Refresh, wait for completion, then recheck. A successful connection authorization is not a successful import. |
| REPORTING_WINDOW_INCOMPLETE | Inspect missing account dates and import that range. Verify zero-activity days manually; absence is not assumed to be zero. |
| CURRENCY_UNKNOWN / TIMEZONE_UNKNOWN | Refresh provider metadata or have an owner/admin record verified account settings with a reason. Missing metric currency still needs a corrected import; overriding context does not rewrite rows. |
| CURRENCY_CONFLICT / TIMEZONE_CONFLICT | Reconcile provider facts, overrides and actual metric context. Clear incorrect overrides or correct upstream data; there is no silent conversion. |
| DESTINATION_UNAVAILABLE / DESTINATION_UNVERIFIED / DESTINATION_STALE | Repair availability and retrieve the exact client/window, unfiltered, from every required destination. Cached or partial retrievals cannot mint fresh proof. |
| EVIDENCE_LIMIT_REACHED | Narrow the window or evaluate individual clients. Do not interpret a bounded partial scan as certification. |

## What this does not prove

Not a reconciliation of totals, campaign completeness, attribution semantics, provider accuracy, account inventory, zero-activity dates, live OAuth/refresh success, or rendered/acknowledged delivery. Existing exports/dispatch remain ungated. Today's partial data remains advisory. Explicit providers survive source removal, but a missing second account from the same provider still requires operator roster reconciliation.

Synthetic unit, PostgreSQL and browser fixtures **do not certify live connectors**. Before any live delivery, manually compare the same account/date/currency/timezone/conversion context with the provider, verify all expected sources and account dates, and retrieve the same window from the intended destination. No such live validation is performed by this implementation.

## Remaining acceptance

See [live-certification gaps and rollout prerequisites](./REPORT_READINESS_EVIDENCE.md). Local fixture success is not authorization to deploy or certification of a real connector.
