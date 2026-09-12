# Operations Hub — Backend Foundation and UI (Slices 1–2)

Status: the read-only backend contract (Slice 1) and the tenant-facing `/operations`
page (Slice 2) are both implemented. The page renders the summary and writes nothing.

This slice adds a tenant-safe, client-aware, read-only aggregation of operational
evidence that already exists in the warehouse. It introduces no schema change, no
migration, no dependency change, no workflow change, and no provider contact.

## Endpoint

`GET /api/operations/summary?workspaceId=<id>[&clientId=<id|all>]`

| Concern | Behaviour |
| --- | --- |
| Auth | Authenticated session required; otherwise `401`. |
| Authz | `requireWorkspaceAccess({ minimumRole: "viewer" })`; non-member `403`. |
| Validation | Strict Zod query schema; unknown, missing, oversized or structurally invalid input → `400`. |
| Client context | Delegated to `resolveClientDataScope` (`surface: "operations"`). |
| Cache | `Cache-Control: private, no-store`. |
| Methods | `GET` only. No mutation method is exported. |
| Writes | Zero. No record is created, updated or deleted. |
| Providers | No provider or destination transport is imported or called. |

Failure mapping is the established client-context contract:

| Resolver outcome | HTTP |
| --- | --- |
| `malformed` | `400` `INVALID_CLIENT` |
| `unsupported_all` / `unsupported_unassigned` | `400` `UNSUPPORTED_CLIENT_SCOPE` |
| `not_found` (rival, deleted, nonexistent) | `404` `CLIENT_NOT_FOUND`, byte-identical bodies |

Rival, deleted and nonexistent clients are indistinguishable, and an invalid
client never widens to workspace-wide evidence.

## Client-context policy

```ts
operations: { allowsAllClients: true, allowsUnassigned: false }
```

`unassigned` is **refused explicitly** rather than guessed. The summary cannot
define "unassigned" consistently across connector health, readiness, delivery
and anomalies, so the scope is rejected with `400` instead of silently widening.

Scope resolution:

- `missing` / `all` → workspace-wide (the intentional behaviour on other surfaces).
- concrete client with `accountAssignmentsConfiguredAt` → **explicit** ownership
  from `ClientProviderAccountAssignment` tuples `(connectionId, provider, accountId)`.
- concrete client without it → **legacy** ownership via `Connection.clientId` pointers.
- explicit client with an empty assignment set → **empty evidence**, never
  workspace-wide data and never inferred from connection membership.

## Response contract

```
{
  version: "operations-summary-v1",
  workspaceId, generatedAt,             // generatedAt comes from the injected clock
  clientContext: { status, client, scope },
  navigation: { sources, reports, clients, explorer, exports, operations },   // internal paths only
  sections: {
    connectorHealth, freshness, ingestion, readiness, delivery, anomalies
  }
}
```

Every section is a discriminated union:

```ts
| { state: "ready" | "attention" | "empty"; data: T; truncated: boolean; limit: number; reason: null; href: string }
| { state: "unavailable" | "unsupported"; data: null; truncated: false; limit: 0; reason: string; href: string }
```

`empty` ("no applicable records") is deliberately distinct from `ready`
("evidence present and healthy"). Unavailable or unsupported evidence is never
collapsed into a healthy zero, and unsupported/unavailable sections carry no
`data` at all.

### Sections, sources and bounds

| Section | Source | Bound |
| --- | --- | --- |
| `connectorHealth` | `ProviderAccountHealth` | whole-population `groupBy` for state; 25 attention rows displayed |
| `freshness` | `Connection` (`type: "source"`) | every source connection read; 25 attention rows displayed |
| `ingestion` | `WarehouseImportJob` + `SyncLog` (via `pipeline.workspaceId`) | whole-window `groupBy` for totals; 25 rows per list; 7-day window |
| `readiness` | `loadReportReadiness` | up to 50 clients evaluated; 10 displayed; default 7-day window |
| `delivery` | `DestinationDeliveryReceipt` | whole-population `groupBy` for staleness; 25 latest per `(client, destination)`; 200 scanned |
| `anomalies` | `CampaignMetric` → `detectMarketingAnomalies` | 25 items; 14-day window; 2 000 rows scanned (state from the scan) |

All lists use explicit sort keys with an `id` tiebreaker, so output is stable
regardless of input order. `truncated` is reported rather than hidden.

**State comes from the whole population; only lists are bounded.** Every section
derives its `state` and its `totals` from an authoritative query over the whole
scoped population, never from the bounded display list:

- `connectorHealth` totals come from a `groupBy` on status — and only the literal
  `"healthy"` counts as healthy, so `status != "healthy"` is an exact predicate
  for attention. The displayed attention rows are fetched with that filter.
- `freshness` reads every source connection for the workspace (a small
  per-tenant table), so a stale or errored connection outside a list bound can
  never be reported as `ready`.
- `ingestion` derives its total *and* its per-status breakdown from the grouped
  counts, and counts sync-log errors authoritatively, so `sum(status) === total`.
- `delivery` derives per-`(client, destination)` recency from a `groupBy` with
  `_max(retrievedAt)`, so `stale` is computed over every pair. This matters
  because the receipt scan is ordered `retrievedAt desc` and therefore drops the
  oldest — exactly the stale — receipts.
- `readiness` evaluates up to `OPERATIONS_READINESS_EVAL_LIMIT` clients (50)
  while displaying `OPERATIONS_READINESS_CLIENT_LIMIT` (10).

Display lists stay capped (`OPERATIONS_LIST_LIMIT` rows for most sections,
`OPERATIONS_READINESS_CLIENT_LIMIT` clients for `readiness`) and `truncated:
true` discloses a capped list, but a capped list never changes the state.

**Truncation fails closed only where the state cannot come from an aggregate.**
`anomalies` detection is row-based, so its state is derived from the bounded
scan. Because rows beyond the bound may be anomalous, a truncated anomalies
section degrades to `attention` instead of reporting `ready`/`empty`, and the
scan reads newest-first so it retains the recent rows detection anchors to.

### Sanitization

Provider-supplied error text passes through `sanitizeEvidenceText`: control
characters removed, whitespace collapsed, tokens of 32+ characters replaced with
`[redacted]`, and the result truncated to 200 characters. Raw credentials,
provider payloads, stack traces, arbitrary error objects and unrestricted
metadata are never returned.

## Freshness semantics — two distinct signals

The repository has two freshness concepts. This summary reports them separately
and never unifies them silently:

| Field | Meaning | Value |
| --- | --- | --- |
| `sourceFreshnessHours` | Connection freshness used by the Sources page (`resolveSourceHealthState`). **This is the state reported per source.** | 24h |
| `escalationHours` | Pipeline / stale-health escalation window (`STALE_AFTER_MS`). Reported only. | 26h |

The 26h escalation job (`evaluateStaleHealth`) **mutates** pipeline rows and is
therefore never invoked by this read-only summary — only its threshold constant
is reused so the two numbers cannot drift apart.

Boundary behaviour is pinned with an injected clock: a source exactly 24h old is
`fresh`; one millisecond older is `stale`.

## Unsupported / unavailable behaviour

| Case | Section state | Reason |
| --- | --- | --- |
| Client-scoped `ingestion` | `unsupported` | `import_jobs_not_client_attributable` |
| Any section whose read fails | `unavailable` | `operations_section_unavailable` |

`WarehouseImportJob` carries JSON children (`items`, `results`) rather than a
client or connection foreign key. Attributing a job to a client would require
inferring ownership from connection membership, so the section is
workspace-scoped only and explicitly unsupported for a concrete client.

Section reads are isolated: one failing section degrades to `unavailable` and
does not fail the whole request. No error detail is returned.

## UI (`/operations`)

The page is a tenant-facing, read-only view of the summary. It renders exactly the
six sections the endpoint returns and adds no evidence of its own.

| Concern | Behaviour |
| --- | --- |
| Route | `/operations` under the `(app)` group; deny-by-default auth via `src/lib/page-access-policy.ts` (no public allowlist entry). |
| Data | One `GET /api/operations/summary` request, keyed by `workspaceId` + `clientId`. |
| Client context | `/operations` is a client-context surface (`surfaceForPathname` → `operations`), so the shared bar renders and the scope propagates across surfaces. |
| Writes | Zero. Every call to action links to an existing authorized surface. |
| State | Each section shows its `state`, its totals, and — when `truncated` is true — an explicit capped-list notice. `unsupported` sections explain the reason instead of showing a zero. |

Presentation helpers live in `src/lib/operations-view.ts` (pure, no server imports)
and are covered by `src/lib/operations-view.test.ts`. The client component imports
the response types with `import type` only, so the server-only loader never enters
the client bundle (enforced by `src/lib/observability/client-boundary.test.ts`).

## Verification

- `src/lib/operations-summary.test.ts` — deterministic aggregation, bounds and
  ordering, empty vs ready vs attention, sanitization, injected-clock boundaries.
- `src/lib/operations-summary.pg.integration.test.ts` — real PostgreSQL isolation:
  cross-workspace, cross-client, **sibling clients sharing one root connection**,
  explicit-empty, legacy, `all`, unassigned refusal, rival/nonexistent fail-closed,
  count/detail scope parity, zero writes.
- `src/app/api/operations/summary/route.test.ts` — `401`/`403`/`400`/`404`,
  viewer access, `private, no-store`, GET-only export surface.
- `src/lib/observability/client-boundary.test.ts` — AST boundary: no provider
  transport import, no database mutation call, GET-only route, clients cannot
  import the server loader, and every resolver-consuming route maps failures.

## Actionable Readiness v1 (Slice 1)

Status: implemented. Converts summary evidence into a small, deterministic, prioritized list of next actions rendered near the top of `/operations`.

- **Pure presentation derivation**: Implemented in `src/lib/operations-view.ts` (`deriveOperationsActions`), safely isolated from server-only code and verified by AST boundary tests.
- **Priority derivation**:
  - `attention` → `"high"` priority (rank 1) when an authoritative count proves a blocking condition: quarantined or errored accounts, stale or failing sources, failed/partial import jobs or sync-log errors, readiness blockers, stale deliveries, or critical/warning anomalies.
  - `attention` degraded to `"medium"` (rank 2) when the evidence is real but is not yet a proven failure: unrecognized connector or source states, readiness coverage that could not be evaluated, or an anomaly evaluation that could not cover every metric row.
  - `attention` degraded to `"low"` (rank 3) when the condition is in flight rather than broken: source connections still pending or syncing their first sync.
  - `unavailable` → `"medium"` priority (rank 2): Service check/recovery action. Never presented as healthy.
  - `unsupported` → `"low"` priority (rank 3): Explains scope limitation (e.g. client-scoped ingestion). Never claims zero incidents or healthy operation.
  - `empty` → `"low"` priority (rank 3): Setup actions when no connections or sources exist in this scope.
  - `ready` → Produces no action. When all sections are ready, renders the calm "No immediate action required" state.
- **Deterministic ordering**:
  1. Priority rank: high (1) > medium (2) > low (3)
  2. Stable section order: `connectorHealth` > `freshness` > `ingestion` > `readiness` > `delivery` > `anomalies`
  3. Action ID: a deterministic comparison as a defensive final tiebreaker. Each section emits at most one action, so it cannot currently change the observed order.
- **Tenant & Client Context Safety**:
  - Actions navigate only to existing authorized product surfaces: `/sources`, `/reports`, `/clients`, `/exports`, `/explorer` (the warehouse importer) and `/operations` itself. No CTA invents a destination.
  - Actions link through `hrefFor(action.cta.href, action.cta.targetScope === "all" ? ALL_CLIENTS_TOKEN : undefined)` via `useClientContextNavigation`, preserving valid client context while stripping unsafe query parameters.
  - A CTA may declare an explicit `targetScope: "all"` (the canonical All Clients sentinel). It is used where the corrective action *is* a scope switch on the same surface: client-scoped `ingestion` links to `/operations?clientId=all`, never to a different page with the unchanged client.
  - Every CTA renders as a plain link. Navigating is a read: no CTA performs a write, and the importer CTA only opens the warehouse surface, where the operator starts an import explicitly.
- **Evidence truthfulness — no exact-zero overstatement**:
  - Counts and copy come from authoritative aggregates over the whole scoped population, never from the capped display slices.
  - A capped slice is never presented as a total. When no authoritative category accounts for an `attention` state, the copy stays explicitly bounded ("Showing N … More may exist in this scope") instead of asserting a total derived from the slice.
  - Fail-closed conditions never render a misleading exact zero: incomplete readiness coverage, an unevaluated readiness state, a truncated anomaly scan and an unclassified source state each produce prose that says the evidence is incomplete, rather than "0 warnings" or "0 anomalies".
  - `unsupported` sections explain the scope limitation instead of showing a zero.
- **Verification**: `src/lib/operations-view.test.ts` pins the derivation (priority, ordering, authoritative counts, scope-aware CTAs, immutability), and `tests/e2e/operations-hub.spec.ts` covers the rendered actions end to end, including the All Clients scope switch and the `/explorer` importer destination.

## Remaining work (future UI slice)

- Per-blocker remediation deep links (readiness currently exposes only section-level hrefs).
- Optional historical connector-health timeline (requires a telemetry sink; today telemetry is log-only).
