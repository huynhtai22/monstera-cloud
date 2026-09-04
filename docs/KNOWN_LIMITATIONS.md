# Monstera Cloud — Known Limitations

Last reviewed: 2026-09-04 (targeted billing, AI/tenant and provider-health review; not a fresh production audit)
Release stage: Controlled Pilot

## Current release posture

Production-capable architecture, suitable for controlled pilot use, with documented operational hardening remaining before broad GA.

The August evidence is historical, not blanket approval of newer billing/AI/portfolio surfaces. See [September security validation](./SECURITY-VALIDATION-2026-09-04.md) for local fixes, test coverage, and separate production acceptance gates. Local validation does not establish that these changes have been deployed.

**Google Ads status update (2026-08-25):** Basic Access is approved, removing the prior external developer-token approval blocker. Production connector validation is still pending: a real authorized account must complete bounded OAuth, MCC/customer selection, a seven-day sync, reconciliation, and destination retrieval. This is not a claim of controlled-pilot readiness; see [google-ads-basic-access.md](./google-ads-basic-access.md).

## ETL / Sync

### 1. Overlapping connection sync protection

**Status:** Implemented (2026-08-24, PR pending merge at time of writing) — verified by real-PostgreSQL concurrency suites.

Connection-scoped PostgreSQL lease with fencing token is implemented in `src/lib/connection-sync-lease.ts` (advisory xact lock + `SyncLock` lease row + monotonic `fencingToken`, 20-minute lease with heartbeat renewal). All execution paths (manual sync, cron warehouse refresh, batch import, OAuth backfill, pipeline pre-sync) funnel through `syncConnectionData`, which acquires the lease and fences outcome persistence.

Coverage as of this hardening pass:

- Outcome persistence (`lastSyncAt`/`lastError`/`status`) is lease-fenced everywhere, including pipeline runs, which now hold source + destination leases across ETL.
- Row-level ingestion is fenced for all providers: Meta per-ad-account leases, and Google Ads / TikTok / Shopee / Lazada via `upsertCampaignMetric` lease stamping + heartbeat self-abort.
- Shopee fleet token refresh holds the connection lease (refresh tokens are single-use; overlapping refreshes are skipped until the next cycle).
- Admin force-unlock expires lease rows instead of deleting them, preserving `fencingToken` monotonicity.

**Remaining notes (accepted):**

- `WarehouseImportJob` uses leaseId + expiry CAS fencing without a monotonic token column (safe; less forensic detail).
- A non-fenced `lastError` write remains on the warehouse-refresh error path (best-effort diagnostics write).
- Stale-worker protection is application-layer enforcement, not PostgreSQL RLS.

### 2. Deleted / missing provider row reconciliation

**Status:** Partially addressed — observability implemented; deletion/reconciliation policy remains a limitation.

`9d6f572` added complete-snapshot stale-row detection in `provider-row-reconciliation.ts`, invoked by Meta, Google Ads and TikTok sync paths. Unit and real-PostgreSQL tests verify that incomplete fetches do not produce false comparisons, tenant scope is retained, and missing rows are detected **without mutation**.

Missing rows are still retained. This is not automatic provider deletion reconciliation, soft deletion, or a retention policy. Do not move the entire limitation to Resolved or enable deletion without an approved retention decision and isolated drill.

### 3. Data-through-date semantics

**Status:** Separate reporting date implemented; provider-level accuracy remains a certification concern.

`lastSyncAt` represents sync completion, not the latest reporting date. `Connection.lastDataThrough` and reporting-readiness/warehouse DTOs now expose separate reporting freshness. Do not substitute completion time for reporting date, or assume every provider's real-account reporting coverage is certified merely because the field exists.

### 4. Retry pickup latency

**Status:** Limitation

Provider retry backoff may be eligible within seconds or minutes, but production cron cadence can delay pickup until the next scheduler run. The current scheduler cadence is approximately 15 minutes.

**Future:** Evaluate queue-driven retry execution if pilot usage requires lower latency.

### 5. Poison-account isolation

**Status:** Resolved in code for Meta, Google Ads and TikTok — see Resolved §16.

Live provider recovery/certification evidence remains separate; do not infer equivalent quarantine behavior for every marketplace connector.

## Provider-specific

### 6. Shopee timezone bucketing

**Status:** Limitation

Some Shopee order-derived reporting is bucketed using UTC timestamps. For non-UTC shops, transactions near local midnight may land on a neighboring reporting date.

**Future:** Shop-local timezone-aware bucketing.

### 7. Shopee Ads best-effort behavior

**Status:** Limitation

Shopee Ads availability may depend on API capability/availability and remains best-effort compared with primary ad providers. Document this clearly before broad exposure.

## Normalization / warehouse

### 8. Rolling attribution model

**Status:** Working / production-shaped

Meta, Google Ads, TikTok, and marketplace providers re-fetch a bounded rolling history and use deterministic/idempotent warehouse upserts. This correctly handles most late-arriving conversion and attribution updates.

Do not redesign this architecture unless production evidence requires it.

### 9. Mixed currency

**Status:** Hardened with limitation

Currency is preserved per row/account. Do not perform unsafe cross-currency aggregation without an explicit base-currency conversion layer.

**Future:** Optional FX normalization.

## Google Sheets add-on

### 10. Sheets query scheduling

**Status:** Intentional product boundary

The Google Sheets add-on does not independently poll providers or execute every 15 minutes. Sheets reads from the Monstera warehouse when:

- **Get data** is clicked.
- **Refresh Current Sheet** is used.

Provider/warehouse freshness is owned by the Monstera backend scheduler. Do not add Apps Script scheduling unless actual pilot demand requires it.

### 11. Report level semantics

**Status:** Limitation

The Sheets add-on sends `reportLevel` values such as `campaign`, `account`, and `adset`. The current warehouse endpoint accepts the parameter and includes it in caching, but campaign-level selection does not yet necessarily perform a distinct aggregation/grouping operation.

**Future:** Implement explicit report-level aggregation only if user need is confirmed.

## Verification / release discipline

### 12. PostgreSQL integration coverage

**Status:** Verification gap

Some PostgreSQL-dependent integration tests are skipped in local environments without a safe `DATABASE_URL`.

Before broad GA:

- Run the PostgreSQL-backed integration suite.
- Verify connection locking/concurrency.
- Record evidence in release notes.

## Cross-platform output and account ordering

### 13. Cross-platform common-field output vs true blended aggregation

**Status:** Intentional limitation / future enhancement

The Google Sheets add-on can write normalized rows from multiple supported platforms into the same sheet using the shared canonical field set.

**Current behavior:**

- Meta Ads, Google Ads™, TikTok Ads, and other supported sources can be represented as normalized rows with a `platform` field.
- **All Platforms (Common Fields)** means union/stacking of compatible normalized rows.
- It does **not** calculate a single blended spend, revenue, conversions, or ROAS total across platforms.

**Reason:**

- Currencies may differ between accounts/platforms.
- Provider attribution and conversion semantics are not always directly equivalent.
- Unsafe cross-platform aggregation could produce misleading reporting.

**Future:**

- Optional base-currency / FX normalization.
- Clearly defined blended-metric semantics.
- Explicit aggregated cross-platform reporting mode.

Do not present **All Platforms** as mathematically blended reporting until those safeguards exist.

### 14. Multi-account output ordering

**Status:** Limitation / future UX enhancement

Users can currently select multiple ad accounts, but there is no business-defined ordering control for how those accounts are arranged in the resulting sheet.

An agency may eventually want output ordered as Account 1 → Account 3 → Account 7 → Account 2 rather than alphabetical, API-return, or account-ID order.

**Current expectation:** Output remains deterministic and stable for identical queries.

**Recommended default ordering:**

- Platform.
- Account name / account ID.
- Date.
- Campaign.
- Ad set / ad group.

**Future:**

- Drag-and-drop account priority in the sidebar.
- Preserve selected account order in the query payload.
- Sort returned rows according to that explicit business-defined order.

Do not add custom account ordering before Marketplace approval unless pilot users demonstrate a clear recurring need.

## Resolved

### 16. Durable poison-account health and quarantine

`9d6f572` (2026-09-03) added durable `ProviderAccountHealth` records, reconnect-required/quarantined states, sibling-account isolation, and skip sets consumed by Meta, Google Ads and TikTok sync. `provider-account-health.test.ts` and `provider-account-health.pg.integration.test.ts` pass in the September 4 isolated PostgreSQL validation.

This resolves the absence of durable account state described in §5; it does not certify real provider credentials, approval status, or operator alert delivery.

### 15. Source disconnect no longer deletes historical warehouse data

**Status:** Resolved — 2026-08-22
**Priority:** Previously P1

**Disconnect** (`DELETE /api/connections/[id]`, `src/lib/connection-lifecycle.ts`):

- stops future synchronization — `Connection.status = "disconnected"`; the manual sync route returns `409 CONNECTION_DISCONNECTED`, and cron/token-prefetch/import-batch paths already select only `status: "connected"`;
- revokes stored provider credentials (replaced with a `{ revoked: true, revokedAt }` payload);
- pauses pipelines referencing the connection (`status: "paused"`; pipeline rows and sync logs retained);
- **retains all historical `CampaignMetric` rows**.

Sync-outcome writers are guarded so an in-flight sync that races with Disconnect cannot flip the connection back to `connected`.

**Delete source data permanently** (`DELETE /api/connections/[id]/purge` with body `{ "confirm": "delete" }`):

- separate destructive operation; requires explicit confirmation payload;
- deletes the connection's pipelines, retained `CampaignMetric` history, and the `Connection` record — all scoped to the owning workspace.

**Reconnect** reuses the same `Connection` row via the `workspaceId + provider + remoteAccountId` identity upsert (`src/lib/connection-upsert.ts`), so retained metrics keep their `connectionId` and the deterministic unique key prevents duplicates on the next sync.

Regression coverage: `src/lib/connection-lifecycle.test.ts` and `src/lib/connection-lifecycle.pg.integration.test.ts`.

**Release evidence:**

- Merge SHA: `3f0f908c599116d56e71a5a724e9de485674c2db`.
- Production `/api/version` SHA: `3f0f908c599116d56e71a5a724e9de485674c2db`.
- Real PostgreSQL 16 retention, isolation, fencing, reconnect, and rollback coverage passed in CI.
- CI passed with 139 tests passed and 0 skipped.

**Historical note — observed production evidence 2026-08-21:** before this fix, a Google Ads disconnect deleted the connection's `CampaignMetric` rows, and the history could not be re-synced while the developer token was pending production approval.

## Production schema drift vs `prisma/schema.prisma` — ACCEPTED for pilot (2026-08-23)

**Status:** Accepted limitation, documented per audit gap 11. Revisit before GA.

The live production database diverges from the migration-produced schema in ways that predate the current baseline (`_prisma_migrations` carries 15 resolved/NULL baselining entries). Verified by owner-executed read-only `prisma migrate diff` on 2026-08-23; full inventory preserved at [evidence/prod-schema-drift-20260823.txt](./evidence/prod-schema-drift-20260823.txt).

**Inventory:** 6 tables absent (`ReportSchedule`, `UserDashboard`, `DataQualityViolation`, `SchemaVersion`, `DashboardTemplate`, `SyncLogDetail`) · 17 altered columns (mostly defaults/nullability on `CampaignMetric`; `Connection.remoteAccountId`; `SyncLock` timestamp types) · 14 index/FK differences (including the functional equivalent of the CampaignMetric unique key under legacy Postgres naming, and a missing `SyncCheckpoint.pipelineId` FK).

**Why accepted:**

- The absent tables have no pilot call sites; every app-critical path is exercised daily against the columns that do exist.
- The drifted `CampaignMetric` unique constraint is functionally present under a different name — deterministic upserts and lease fencing operate correctly.
- Production, CI's fresh-migrated database, and the 2026-08-23 restore drill all behave identically where it counts; the 2026-08-23 restore drill proved backup copies are app-compatible.

**Known consequence:** CI's drift gate compares only *fresh* databases, so this drift is invisible there. Any migration touching the drifted tables/columns must be hand-checked against production shape first.

**Forced re-baseline triggers (any one of these):**

1. Before broad GA.
2. Any new feature that reads/writes one of the 6 absent tables or the drifted columns.
3. A migration that fails against production due to this drift.

## Pilot rule

These limitations do **not** block the current controlled pilot unless one causes:

- Tenant-isolation failure.
- Credential/security exposure.
- Incorrect provider identity mapping.
- Destructive data writes.
- Materially misleading financial/reporting output.

For every future release:

1. Review this file.
2. Move resolved items into a **Resolved** section.
3. Record the fixing commit SHA and verification evidence.
4. Add newly discovered PASS WITH LIMITATION / deferred issues.
