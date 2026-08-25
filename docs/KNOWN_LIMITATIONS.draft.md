# Monstera Cloud — Known Limitations

Last reviewed: 2026-08-22 (DRAFT — statuses reflect merge state as of this draft; do not commit as final until pending branches merge)
Release stage: Controlled Pilot

## Current release posture

Production-capable architecture, suitable for controlled pilot use, with documented operational hardening remaining before broad GA.

## ETL / Sync

### 1. Overlapping connection sync protection

**Status:** Resolved — 2026-08-22 (merge `8827978`, CI `verify` SUCCESS)

Manual, cron, retry, pipeline, or warehouse-triggered syncs may overlap for the same connection unless the PostgreSQL-backed connection lease/fencing implementation is completed and verified.

**Planned:**

- Connection-scoped PostgreSQL lease.
- Fencing generation/token.
- Owner-safe release.
- Expired lease recovery.
- Real PostgreSQL concurrency verification.

Implemented and merged: connection-scoped PostgreSQL lease with fencing token, owner-safe release, expiry recovery, and fenced outcome persistence (`src/lib/connection-sync-lease.ts`, `src/lib/sync-connection.ts`); real PostgreSQL concurrency coverage in `src/lib/meta-sync-lock.pg.integration.test.ts` and `src/lib/sync-outcome-fencing.pg.integration.test.ts` runs in CI.

### 2. Deleted / missing provider row reconciliation

**Status:** Mitigated — detection-only (branch `codex/provider-row-reconciliation`, unmerged); universal safe reconciliation still deferred

Rolling re-sync and deterministic upserts correctly update returned rows, including late-arriving attribution changes. However, when a provider permanently stops returning a previously stored row, Monstera does not universally reconcile or soft-delete that missing row.

**Mitigation:** `computeStaleRowStats` detects warehouse entities absent from a PROVABLY complete provider fetch (complete pages, full window, zero failed rows) and logs/reports them as possibly-stale — never deletes or rewrites rows; incomplete syncs refuse to compare. **Still deferred:** universal reconciliation (soft-delete, filtering policy for Sheets/Looker outputs, coverage beyond the Meta reference path) requires a product decision and is NOT implemented.

### 3. Data-through-date semantics

**Status:** Resolved — 2026-08-22 (merge `8827978`, CI `verify` SUCCESS)

`lastSyncAt` currently represents successful sync completion time, not the maximum reporting date actually present in the warehouse.

Dashboard and Warehouse workbench now derive `dataThroughDate` from workspace-wide `MAX(campaignMetric.date)` (`summary.dateRange.latest`), never from the selected range end; empty vs filter-empty states are distinguished; partial syncs render as Partial, not Connected (`src/lib/warehouse-truth.ts`). `lastSyncAt` remains the successful-sync-completion clock.

### 4. Retry pickup latency

**Status:** Intentional product boundary / Decision required

Provider retry backoff may be eligible within seconds or minutes, but production cron cadence can delay pickup until the next scheduler run. The current scheduler cadence is approximately 15 minutes.

Cron cadence (~15 min) owns retry pickup; backoff is bounded and honest. Queue-driven retry would be new infrastructure — requires demonstrated pilot need and product approval (no queue added).

### 5. Poison-account isolation

**Status:** In progress — branch `codex/provider-account-health` (unmerged; committed locally only — NOT Resolved)

**Coverage scope when merged:** per-account health is enforced in the Meta ad-account, Google Ads customer, and TikTok advertiser sync loops (the only providers with child-account fan-out). Shopee and Lazada sync a single connection-level "orders" target with no child accounts — connection-level status (`Connection.status`/`lastError`) remains their isolation mechanism. Warehouse-import/batch paths reuse `syncConnectionData` and inherit the loop coverage. Remaining scope after merge: none for child-account quarantine; surfaced health state in UI is future UX.

Individual provider-account failures are isolated within a sync run, but there is no durable per-account quarantine / reconnect-required state. Permanently broken child accounts may be retried on later jobs.

Durable `ProviderAccountHealth` state (healthy/degraded/quarantined/reconnect_required) with quarantine after 3 consecutive non-retryable failures, immediate reconnect_required on auth failures, automatic recovery on success, and healthy-sibling isolation. Pending merge; until then run-scoped isolation still applies.

## Provider-specific

### 6. Shopee timezone bucketing

**Status:** Mitigated — UTC behavior is now explicitly surfaced (branch `codex/shopee-timezone-correctness`, unmerged); shop-local rebucketing remains deferred

Some Shopee order-derived reporting is bucketed using UTC timestamps. For non-UTC shops, transactions near local midnight may land on a neighboring reporting date.

**Mitigation:** bucketing stays UTC — re-bucketing existing orders would re-key the deterministic unique key and double-count history — but the behavior is no longer silent: `monsteraBucketingTimezone` is exposed on shop-info, the shop's own offset is detected when the provider exposes one (never guessed), and midnight-boundary behavior has regression tests. **Still deferred:** shop-local bucketing requires a scoped migration plus a reconciliation decision; near-midnight orders for non-UTC shops still land on the neighboring UTC day.

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

**Status:** In progress — branch `codex/reporting-truthfulness-guardrails` (unmerged)

The Sheets add-on sends `reportLevel` values such as `campaign`, `account`, and `adset`. The current warehouse endpoint accepts the parameter and includes it in caching, but campaign-level selection does not yet necessarily perform a distinct aggregation/grouping operation.

`reportLevel` is now validated (unknown levels → structured 400), `ad` filters raw rows, and `adset`/`campaign`/`account` perform true SQL group-by aggregation with currency in the group key (no blending); responses carry `reportLevel`/`aggregated` metadata. Pending merge.

## Verification / release discipline

### 12. PostgreSQL integration coverage

**Status:** Core Resolved — 2026-08-22 (PG suites run in CI `verify`, all green on merge `ea8bd3e`); CI fail-closed discipline In progress on branch `codex/pg-ci-discipline` (unmerged)

Some PostgreSQL-dependent integration tests are skipped in local environments without a safe `DATABASE_URL`.

Before broad GA:

- PostgreSQL-backed integration suites run in CI's postgres:16 service and passed on merges `8827978`/`ea8bd3e` (locking, fencing, tenant isolation, retention).
- `codex/pg-ci-discipline` makes the suites FAIL (not skip) when CI=true lacks a reachable database.
- Release evidence: migration check (`prisma migrate diff`), concurrency tests, security-path tests, typecheck, lint, build, CI status.

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

**Status:** In progress — branch `codex/sheets-account-ordering` (unmerged)

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

Implemented on the branch: the add-on preserves selection order (no alphabetical sort), the server orders returned rows by that explicit account sequence with a deterministic fallback (platform → account → date desc → campaign), covered by `src/lib/warehouse-row-ordering.test.ts`. Drag-and-drop remains future UX (Marketplace-approval gated).

Do not add custom account ordering before Marketplace approval unless pilot users demonstrate a clear recurring need.

## Resolved

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
