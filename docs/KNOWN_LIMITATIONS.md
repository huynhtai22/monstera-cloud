# Monstera Cloud — Known Limitations

Last reviewed: 2026-08-21
Release stage: Controlled Pilot

## Current release posture

Production-capable architecture, suitable for controlled pilot use, with documented operational hardening remaining before broad GA.

## ETL / Sync

### 1. Overlapping connection sync protection

**Status:** P1 / pending hardening

Manual, cron, retry, pipeline, or warehouse-triggered syncs may overlap for the same connection unless the PostgreSQL-backed connection lease/fencing implementation is completed and verified.

**Planned:**

- Connection-scoped PostgreSQL lease.
- Fencing generation/token.
- Owner-safe release.
- Expired lease recovery.
- Real PostgreSQL concurrency verification.

Do before broad GA.

### 2. Deleted / missing provider row reconciliation

**Status:** Limitation

Rolling re-sync and deterministic upserts correctly update returned rows, including late-arriving attribution changes. However, when a provider permanently stops returning a previously stored row, Monstera does not universally reconcile or soft-delete that missing row.

**Future:** Provider snapshot reconciliation / stale-row detection.

### 3. Data-through-date semantics

**Status:** Limitation

`lastSyncAt` currently represents successful sync completion time, not the maximum reporting date actually present in the warehouse.

**Future:** Expose a separate `dataThroughDate` / reporting-freshness indicator.

### 4. Retry pickup latency

**Status:** Limitation

Provider retry backoff may be eligible within seconds or minutes, but production cron cadence can delay pickup until the next scheduler run. The current scheduler cadence is approximately 15 minutes.

**Future:** Evaluate queue-driven retry execution if pilot usage requires lower latency.

### 5. Poison-account isolation

**Status:** Limitation

Individual provider-account failures are isolated within a sync run, but there is no durable per-account quarantine / reconnect-required state. Permanently broken child accounts may be retried on later jobs.

**Future:** Durable account-health state and quarantine policy.

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

### 15. Source disconnect no longer deletes historical warehouse data (fixed)

**Status:** Fixed — disconnect is now non-destructive; permanent deletion is a separate explicit operation
**Priority:** Resolved (previously P1)

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

Regression coverage: `src/lib/connection-lifecycle.test.ts`.

**Historical note — observed production evidence 2026-08-21:** before this fix, a Google Ads disconnect deleted the connection's `CampaignMetric` rows, and the history could not be re-synced while the developer token was pending production approval.

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
