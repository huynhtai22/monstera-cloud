# Seat-sharing economics: measurement framework (H1/H2)

> Status 2026-09-19: framework + build spec. Nothing here runs until the
> usage counter (Build A) is merged and `npx prisma db push` / migrate-deploy
> applies its migration. All queries assume Postgres + the current
> `prisma/schema.prisma` names (quoted identifiers below match exactly).
>
> Policy note 2026-09-20: Agency Pro and Enterprise remain the only public
> commercial offers. The flexible allowance is enforced through internal
> lifecycle/compatibility states: Free fallback 3, legacy Starter 4, Agency
> Pro/Pilot 8, and Enterprise 15, plus one 24-hour overflow browser. Treat this
> as the enforcement baseline for future H1/H2 comparisons; do not compare it
> as though the former Free cap of 2 is live.

## 1. What this proves, and the decision it buys

Two hypotheses from the seat-sharing review. Each ends in a named action —
no further analysis required at readout:

| # | Hypothesis | Metric | Pass threshold | Action on pass | Action on fail |
|---|---|---|---|---|---|
| H1 (cost) | Caps + friction cut free-workspace usage intensity | Median weekly touches per free workspace | Down **10–25%** by weeks 5–8 vs weeks 1–4 | Keep enforcement; report saved infra as margin | Sharing wasn't the leak → pivot metering attention to connections/workspaces |
| H2 (support) | Burden doesn't rise | Support tickets per paying workspace per 30d | Flat (±noise); session-tagged never top-3 through week 8 | Keep; continue monthly watch | >20% sustained lift → lengthen grace or return to telemetry-only before stronger enforcement |

Combined outcomes: H1✓H2✓ keep · H1✓H2✗ soften · H1✗H2✓ pivot · H1✗H2✗ roll back to telemetry-only (P0).

## 2. Data provenance — every claim traces to a table

| Claim | Source table (columns) | Writer | Available since | Retention risk |
|---|---|---|---|---|
| Login touches | `"LoginEvent"` (`userId`, `method`, `ipHash`, `createdAt`) | `recordLoginEvent` (P0) | P0 migration deploy | Unbounded growth — needs the 90d prune (open item §7) |
| Key hits | `"ApiKey"` (`useCount`, `lastUsedAt`) — cumulative | `touchApiKeyUsage` (P0) | P0 deploy | Cumulative counter: **no history reconstructible** — deltas only going forward |
| Imports | `"WarehouseImportJob"` (`workspaceId`, `status`, `createdAt`) | import worker/cron | Pre-existing | Existing retention applies |
| Sessions enforced | `"UserSession"` (`revokedAt`, `lastSeenAt`) | `registerSession` (P1) | P1 migration deploy | Revoked >90d pruned on login |
| Pin abuse | `"AuditEvent"` (`action='api_key.pin_rejected'`) | `auditApiKeyPinRejection` (follow-up slice) | Follow-up deploy | Existing retention applies |
| Support burden | `"SupportTicket"` (`workspaceId`, `reason`, `tag`, `status`, `createdAt`) | `upsertOpenTicket` + human triage | Pre-existing | Keep; never delete open tickets |
| Usage truth | `"WorkspaceDailyUsage"` (new, §3) | `recordUsage` (Build A) | Build A deploy (= T0) | 90d rolling delete via cron |

Notes:
- `ApiKey.useCount` can never backfill history (cumulative). Pre-T0 usage intensity must come from timestamped event tables (`LoginEvent`, `WarehouseImportJob`) — §4 uses them as baseline proxies.
- Free vs paying comes from `"Workspace"("plan")` joined via `"WorkspaceMember"("workspaceId","userId")`. Exclude `plan='pilot'` invitees and `PRO_WHITELIST_EMAILS` owners from both cohorts (atypical usage, tiny N, high variance).

## 3. Build A — the missing usage counter (prerequisite, ~2h)

H1 is untestable without it: the catalog advertises "refreshes per month"
(`public-plan-catalog.ts`) that nothing counts today.

Schema (additive migration; registers in `TENANT_GUARDED_MODELS` or the
schema-coverage test fails — it has a required `workspaceId`):

```prisma
model WorkspaceDailyUsage {
  workspaceId String
  /// UTC-midnight bucket. One row per workspace per day — bounded growth.
  date        DateTime
  queryCount  Int      @default(0)
  importCount Int      @default(0)
  keyHitCount Int      @default(0)
  updatedAt   DateTime @updatedAt
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, date])
  @@index([date])
}
```

Helper (`src/lib/usage-meter.ts`, fail-open like P0 telemetry):

```ts
recordUsage(workspaceId: string, kind: "query" | "import" | "keyHit"): Promise<void>
// single upsert: creates today's bucket or increments it; never throws.
```

Instrument exactly four read paths (each one line, after auth):
1. `GET /api/metrics/query` → `query`
2. `GET /api/dashboard/summary` → `query`
3. `GET /api/looker-studio` data hits (not `ping=1`) → `keyHit`
4. `GET /api/export/rows` (after key auth) → `keyHit`

Write-amplification note: one extra indexed upsert per read. Acceptable —
per-plan query caps bound the volume (free ≤100/mo), and the write is
fire-and-forget. If p99 latency moves, batch in memory per instance first.

Tests: unit (bucketing/UTC-midnight, fail-open on DB error) + one
`.pg.integration.test.ts` (two records same day → count 2, one row).

## 4. Baseline protocol (weeks 1–4, T0 = Build A deploy)

Honest limitation, stated upfront: P1/P2 enforcement is already live, so
there is **no clean pre-treatment baseline**. Weeks 1–4 measure partially
treated behavior (grandfathered pre-P1 JWTs, no `jti`, still active up to
30d). Consequence: any H1 drop measured in §5 **understates** the true
effect (conservative bias — a pass is a strong pass; a marginal fail is
ambiguous, not disproof).

Week 1 runs a calibration check — the new counter must approximately equal
the independent proxies, or instrumentation is buggy and the clock restarts:

```sql
-- Calibration: counter vs proxies, week 1, free workspaces.
-- Expect same order of magnitude; investigate if ratio < 0.5 or > 2.
WITH counter AS (
  SELECT "workspaceId", SUM("queryCount"+"importCount"+"keyHitCount") AS c
  FROM "WorkspaceDailyUsage"
  WHERE "date" >= date_trunc('week', NOW()) AND "workspaceId" IN
    (SELECT id FROM "Workspace" WHERE plan = 'free')
  GROUP BY "workspaceId"
),
proxies AS (
  SELECT m."workspaceId", COUNT(*) AS p
  FROM "LoginEvent" e
  JOIN "WorkspaceMember" m ON m."userId" = e."userId"
  JOIN "Workspace" w ON w.id = m."workspaceId" AND w.plan = 'free'
  WHERE e."createdAt" >= date_trunc('week', NOW())
  GROUP BY m."workspaceId"
)
SELECT COUNT(*) AS workspaces,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY c.c) AS median_counter,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY p.p) AS median_proxy
FROM counter c FULL JOIN proxies p ON p."workspaceId" = c."workspaceId";
```

Baseline outputs (frozen, stored as a comment row or ops doc, not code):
median weekly touches per free workspace, p90 same, tickets per paying
workspace per 30d, session-tagged share. Per-workspace medians throughout —
never totals (signup growth would fake a win or a loss).

## 5. Readout protocol (weeks 5–8)

H1 — median weekly touches per free workspace, from the counter:

```sql
SELECT date_trunc('week', "date") AS wk,
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY "queryCount"+"importCount"+"keyHitCount") AS median_touches,
       percentile_cont(0.9) WITHIN GROUP (
         ORDER BY "queryCount"+"importCount"+"keyHitCount") AS p90_touches
FROM "WorkspaceDailyUsage" d
JOIN "Workspace" w ON w.id = d."workspaceId" AND w.plan = 'free'
WHERE "date" >= NOW() - INTERVAL '8 weeks'
GROUP BY wk ORDER BY wk;
```

Pass: weeks-5–8 median 10–25% below weeks-1–4 median. Paid-workspace
series computed identically as a control — it must stay flat, else the move
is seasonality/product-wide, not the intervention.

H2 — tickets per paying workspace, plus canaries:

```sql
-- Overall burden (paying = non-free plans).
SELECT COUNT(*)::float / NULLIF(COUNT(DISTINCT t."workspaceId"), 0) AS tix_per_ws
FROM "SupportTicket" t JOIN "Workspace" w
  ON w.id = t."workspaceId" AND w.plan <> 'free'
WHERE t."createdAt" >= NOW() - INTERVAL '30 days';
-- Canary: session/key-tagged share (tag discipline §6).
SELECT tag, COUNT(*) FROM "SupportTicket"
WHERE "createdAt" >= NOW() - INTERVAL '30 days'
  AND (tag IN ('session','api-key') OR reason = 'auth')
GROUP BY tag ORDER BY COUNT(*) DESC;
-- Machine canary: pin-rejection rate (no human triage needed).
SELECT COUNT(*) FROM "AuditEvent"
WHERE action = 'api_key.pin_rejected' AND "createdAt" >= NOW() - INTERVAL '30 days';
```

Pass: overall flat; session tags never top-3; pin rejections low and flat.
Fail trigger: >20% sustained lift through week 8.

## 6. Tag discipline (makes the H2 canary real)

`SupportTicket` dedupes by fingerprint (one open ticket per
reason/connection/tag per workspace), so auto-filing is bounded and safe:
- Human triage: first touch on any login/session/key ticket sets
  `tag='session'` or `tag='api-key'`. One-line convention, enforced in the
  weekly readout (untagged auth tickets get tagged before counting).
- Machine: `reason='auth'` already isolates the family; pin rejections flow
  to `AuditEvent`, not tickets, to avoid ticket spam from hammered keys.

## 7. Remaining operational items

1. **Done in this branch:** `LoginEvent` and `WorkspaceDailyUsage` use a
   bounded 90-day rolling cleanup invoked by the authenticated master cron.
2. Free-plan grandfathering date: record the P1 deploy date as T0′ for the
   report footnotes (explains weeks-1–4 conservative bias).
3. Refresh the stale `UNIT_ECONOMICS.md` prices (299k/699k) to the live
   Agency Pro 1.49M₫ before citing breakeven anywhere in readouts.
4. Run the four synthetic scenarios against the preview database and record
   their event-based outcomes before merge. Local disposable-Postgres coverage
   is necessary but is not preview certification.
5. Have qualified counsel review the credential-sharing clause before using it
   as the basis for suspension or a customer dispute.

## 8. Cadence and owners

- Eng: Build A + migration + tests (one slice, ~half day with review).
- Support: tag discipline from T0 (5 min training, one example ticket).
- Founder: 15-min weekly readout weeks 1–8 using the four queries above;
  go/no-go at week 8 per the §1 table. Monthly watch on H2 thereafter.
- Running cost of the whole framework: ~0 (one upsert per read, four
  indexed reads per week, no new infra).
