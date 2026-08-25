# Implementation record — Google Ads controlled-pilot readiness

**Status:** implementation in the focused branch; live validation remains pending.
**Roadmap:** [PRODUCT_ROADMAP_2026.md](../PRODUCT_ROADMAP_2026.md), Phase 0.

## User problem and story

An agency operator connecting Google Ads needs to select only the accounts actually returned by that authorization, run a bounded import, and see whether the result is fresh, pending, partial, stale, disconnected, or needs recovery. They must not be told a source is healthy when it has never completed or its last completed result is stale.

## Evidence and gap

- Google OAuth and MCC leaf discovery already exist in `src/lib/google-ads.ts`; unavailable Google customer roots are excluded during discovery.
- `POST /api/connections/[id]/accounts` accepted arbitrary selected account IDs before persistence, rather than proving they belonged to the connection.
- Partial syncs are persisted as a `[partial]` connection error, while Dashboard treated any `lastError` as generic `error`; Sources separately inferred state and did not derive stale health.
- `Connection.lastSyncAt` is only advanced through sync-outcome persistence on valid success, so this slice preserves that durable source of truth.

## In scope

1. A pure shared health resolver with documented state precedence: `disconnected → partial → error → unknown → syncing → pending → stale → fresh`.
2. Migrate Dashboard and the Sources connection API/list to consume that result. Make stale and partial outcomes actionable in Dashboard.
3. Validate, normalize, and de-duplicate account selections against stored authorized accounts before persisting them (Meta, Google Ads, and TikTok share this endpoint; Google IDs normalize display dashes).
4. Remove obsolete “globally pending approval” Google messaging while retaining the structured `DEVELOPER_TOKEN_NOT_APPROVED` classification.
5. Add a pure reconciliation utility that compares bounded Google totals while retaining account, date, timezone, currency, campaign scope, and conversion semantics.
6. Add unit coverage and controlled-pilot documentation.

## Out of scope

No schema migration; no provider API call; no production configuration change; no broad customer-facing reconciliation UI; no Health Center page; no redesign of SyncJob/WarehouseImportJob; no durable per-account quarantine; no live financial action.

## Data and state sources

`Connection.status`, `lastError`, and `lastSyncAt` are the health inputs. Dashboard adds its observed active SyncJob; Sources receives a server-computed state and retains client-side optimistic activity while an operator starts a sync. Authorized account IDs come only from encrypted connection credentials. Reconciliation inputs are explicit, sanitized totals and reporting context—never secret values.

## Security and rollback

The selection guard reduces arbitrary-account requests and persists no new data. It does not reveal authorization tokens. The resolver is pure/read-only. Rollback is a single focused revert; it does not require data repair. Existing connection credentials and historic warehouse rows remain unchanged.

## Test strategy and acceptance criteria

- Unit tests cover every resolver precedence case, source count semantics, Google account normalization/selection rejection, and reconciliation-context mismatch/metric deltas.
- Existing Google Ads, OAuth, error taxonomy, tenant, warehouse, and browser suites remain required verification where the environment can run them.
- Acceptance requires pending not being healthy, partial not becoming generic error in migrated consumers, unknown not being fresh, stale creating Dashboard attention, IDs outside authorization being rejected, and reconciliation requiring matched reporting context.

## Remaining consumers

This first slice migrates Dashboard overview plus Sources API/list and exposes per-connection `dataThroughDate` in Sources. Source detail, client-health, Runs/Sync Activity, and pipeline health retain their existing renderers; Phase 1 must migrate them to the same resolver and surface equivalent coverage before claiming complete health-state consolidation.
