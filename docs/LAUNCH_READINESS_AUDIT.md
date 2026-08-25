# Launch-readiness audit — 2026-08-23 (no-write evidence pass)

Method: read-only probes of live production, GitHub CI, Vercel project state, and the repository. No production data, deployments, or environment variables were touched. Preconditions from the hardening plan were met: Upstash healthy (live-verified), tenant guard merged (#69), lease fencing merged (#70).

**Verdict: fit for continued controlled pilot. Not yet GA-ready — the ranked gaps below convert remaining assumptions into a work list.**

---

## Evidence snapshot by domain

| Domain | Status | Evidence |
|---|---|---|
| Production deployment | ✅ Healthy | Verify the current intended SHA and `commitSource: build` through `/api/version` after every alias change; the endpoint is uncached (`cache-control: no-store`) |
| CI on `main` | ✅ Green | Required `verify` includes typecheck, lint, unit/real-PG tests, production build, full Playwright against isolated Postgres, and production dependency audit |
| Scheduled cron | ✅ Healthy | `pilot-cron.yml` runs every ~15–30 min, last three all success (21:22 / 20:53 / 20:29 UTC) |
| Security headers | ✅ Present | CSP, HSTS (`preload`), `X-Frame-Options: SAMEORIGIN`, nosniff, `strict-origin-when-cross-origin`, and `Permissions-Policy`; defined in `next.config.mjs` and probed externally |
| Auth middleware coverage | ✅ Enforced | `/console` `/clients` `/synced-data` `/settings` → 307/308 redirects when signed out |
| Cron fail-closed | ✅ Enforced | `/api/cron/master`, `/api/cron/warehouse-jobs`, `/api/cron/shopee/refresh` → `401` without secret |
| Required env vars present | ✅ Present | Security-relevant set exists with Production scope (names only verified): `UPSTASH_REDIS_REST_URL/TOKEN` (Prod+Preview), `GOOGLE_ID_TOKEN_AUDIENCES`, `CRON_SECRET`, `NEXTAUTH_SECRET/URL`, `ENCRYPTION_KEY`, `DATABASE_URL` |
| Test suites | ✅ Required | Unit + real-PG suites and the full Playwright journey suite run in the required CI job against isolated PostgreSQL |
| Tenant safety | ✅ Fail-closed | Guarded models enforced at query layer (#69); connection leases fenced end-to-end incl. pipeline runs and non-Meta ingestion (#70); runbook shipped (#72) |

---

## Ranked gaps (the top 10)

Ranked by launch risk × effort. "Owner" = who must act.

1. **No synthetic external checks or uptime alerting.** Users discovered the August Upstash outage before any monitor did. A scheduled safe probe of `/api/looker-studio` (expect 401, not 503) + alert on deviation closes the loop the runbook assumes. *Effort S–M. Owner: eng. Plan item 6.* — **Closed 2026-08-23:** `synthetic-checks.yml` probes version/limiter/auth-gate/cron-fail-closed/security-headers every 15 minutes from GitHub Actions; failing scheduled runs notify the owner via Actions email + inline `::error::` annotations.
2. **No restore drill or backup-verification evidence.** Migrations are forward-only, so restore is the only data-level rollback, yet no rehearsed restore exists on record. Run one Neon snapshot restore into a scratch database against a recent commit; record timings. *Effort M. Owner: repo owner (Neon access).* — **Closed 2026-08-23 (drill executed):** Neon branch restored from production history; verified connectivity (2.5s cold connect), migration head `20260819000000_support_tickets` matches prod `/api/version`, pilot-scale row counts intact (38 users / 42 workspaces / 26 connections / 288 campaignMetric / 33 auditEvent / 34 syncLock), and the real app boots against the copy with correct auth gates, cron fail-closed, and schemaVersion reporting. Console-side restore timing was not retained from the Neon console (branch later removed); RTO is recorded as owner-observed "minutes" plus ~2 min verification. **New finding from the drill:** production carries historical schema drift vs `prisma/schema.prisma` — see gap 11.
3. **Full e2e suite is not a CI gate.** CI runs only `test:e2e:smoke`; the two-tenant-isolation and agency-onboarding specs execute locally only (which is exactly how they drifted stale until #71). Add a scheduled/required Playwright job with a Postgres service + rehearsal seed. *Effort M. Owner: eng.* — **Closed 2026-08-23:** CI now runs the full 16-test Playwright suite against an isolated `monstera_e2e` database on every PR and push to main.
4. **No dashboards, alerts, or SLOs wired to existing telemetry.** New Relic and Sentry credentials are configured, but nothing pages anyone; Runbook 1–3 exist without triggers attached. Define 3–4 SLOs (API 5xx rate, p95 latency, cron success, limiter failureCategory rate) with alert policies. *Effort M. Owner: eng. Plan item 6.* — **Closed 2026-08-23 (adapted to stack reality):** the app is serverless on Vercel Hobby — NR's agent cannot run there and its account receives no data (verified empty via API). SLOs are now defined in `docs/SLOs.md` against the signals that actually exist: Sentry (errors), synthetic checks (availability + limiter health, already alerting), Actions cron history, and restore-drill cadence. One manual step remains: enabling a Sentry "new issue" email rule.
5. **Deployment dependency preflight missing from release sequence.** The Upstash incident showed a security change can ship while its external dependency is unreachable. Add a pre-merge/deploy checklist step (env presence + reachability probe) to `PILOT_OPERATIONS.md` release sequence; optionally a script. *Effort S. Owner: eng.*
6. **Scalability unproven.** No production-like benchmark, query-plan review, or retention policy evidence exists (plan item 7). Blocking GA, not the pilot. *Effort L. Owner: eng.*
7. **Activation/onboarding journey not fully proven truthful** (plan item 8): UI-truth and provider-health work exist, but no end-to-end activation walkthrough is recorded against current UI. Partially overlaps fixing smoke-doc Flows B/C (see 9). *Effort M. Owner: eng + owner.*
8. **`Permissions-Policy` header not set.** Minor hardening; all other headers present. One-line addition in `next.config.mjs`. *Effort S.*
9. **Smoke-script Flows B/C unaudited signed-in.** Flow A was corrected in #71; B (console) and C (API keys/Looker) still reference unverified UI strings. Needs one authenticated manual pass. *Effort S. Owner: eng with test account.* — **Closed 2026-08-24:** authenticated UI audit executed against an isolated instance; console renders a **Dashboard** (CONNECTED SOURCES / WAREHOUSE STATE / DESTINATIONS sections — no "Data Sources" page or source tabs exist), and API keys live under Settings → **API Keys** tab ("API keys" heading, **Generate** button, "Copy this key now" banner). Smoke-script Flows B/C rewritten to match; delivery steps C4–C6 additionally proven by the committed activation-journey suite (#80).
10. **Accepted code debts (documented, non-blocking):** `WarehouseImportJob` fences via leaseId+expiry without a monotonic token column; best-effort unfenced `lastError` write on warehouse-refresh error path. Both recorded in `KNOWN_LIMITATIONS.md` §1 — keep them visible in release reviews rather than fixing now.
11. **Production schema has historical drift vs `prisma/schema.prisma`** (discovered during the 2026-08-23 restore drill): the live database diverges from the migration-produced schema — 6 baseline-era tables absent (`ReportSchedule`, `UserDashboard`, `DataQualityViolation`, `SchemaVersion`, `DashboardTemplate`, `SyncLogDetail`), legacy Postgres index names, and column default/nullability differences on `CampaignMetric`. The app runs fine because the drift sits in apparently unused pilot-scope tables plus cosmetic naming, and `_prisma_migrations` carries 15 resolved/NULL entries from baselining — but CI's drift gate only compares *fresh* databases, so this drift is invisible to CI. **Follow-up (no-write first step):** run the same read-only `prisma migrate diff` against production with owner consent, confirm which drifted tables are truly unused, then decide between a re-baselined migration history or documented acceptance. *Effort M. Owner: eng + repo owner.* — **Closed 2026-08-23: ACCEPTED and documented.** Owner executed the read-only diff; output confirmed production carries exactly the same drift signature as the verified-faithful restore copy. Full inventory preserved at [evidence/prod-schema-drift-20260823.txt](./evidence/prod-schema-drift-20260823.txt); formal acceptance with forced re-baseline triggers recorded in [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

---

## Engineering follow-up — 2026-08-25

The ranked list above is a historical evidence record. The following corrections
keep it from being misread as a current to-do list:

- **Google Ads Basic Access — external approval cleared; pilot evidence still pending:**
  Google approved Basic Access on 2026-08-25. This removes the prior approval
  blocker, but does not certify OAuth, manager-account selection, bounded
  synchronization, reconciliation, or Sheets/Looker delivery. The required
  real-account procedure is [google-ads-basic-access.md](./google-ads-basic-access.md).

- **Gap 5 — closed in code:** the dependency preflight is now step 4 of the
  [pilot release sequence](./PILOT_OPERATIONS.md#release-sequence), and the
  guarded release path requires the deployed version to report the intended
  immutable build SHA.
- **Gap 6 — engineering validation closed; GA gate remains:** the benchmark and
  query plans are recorded in [SCALABILITY_EVIDENCE.md](./SCALABILITY_EVIDENCE.md)
  (1.1M rows, no sequential scans, all recorded hot paths under 50 ms). This
  does **not** activate retention; retention ownership and an isolated expiry
  drill remain blocked in [OPERATIONS_ACCEPTANCE.md](./OPERATIONS_ACCEPTANCE.md).
- **Gap 7 — closed in CI:** `onboarding-activation.spec.ts` runs as part of the
  required full Playwright suite, covering the committed activation journey.
- **Gap 8 — closed and externally guarded:** `Permissions-Policy` is set in
  `next.config.mjs`; the scheduled synthetic probe now fails if it disappears.
- **Gaps 1 and 4 — implemented controls, not accepted operations:** synthetic
  checks, SLO definitions, and error telemetry are in place, but alert delivery
  and escalation are still **unverified** until the evidence gate has named
  owners and same-day delivery proof. Do not describe them as fully closed in a
  pilot or GA decision.

### Current remaining owner actions

The only unresolved pilot-readiness items are external, evidence-based controls:

1. Assign primary and backup owners for monitoring, restore authority, and
   retention/deletion approval.
2. Run one non-sensitive production alert delivery and escalation exercise,
   then record its sanitized evidence.
3. Complete the retention decision and isolated expiry drill before enabling
   any automated retention/deletion job.
4. Certify each customer-facing connector with real provider credentials using
   the checklist in `PILOT_OPERATIONS.md`.

---

## Recommended sequence

For each pilot expansion: complete the external evidence gate in
`OPERATIONS_ACCEPTANCE.md`, certify the specific connectors being offered, and
append a new dated evidence pass after material operational changes. Reassess
retention and the accepted schema-drift decision before GA.

*Audit method note: this file should be re-generated (or appended) after each major landing so it stays an evidence log, not a stale checklist.*
