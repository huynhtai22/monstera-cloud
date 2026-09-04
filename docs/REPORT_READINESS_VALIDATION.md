# Report Readiness — implementation and validation handoff

## Current slice: persisted context, requirements and receipts (2026-09-04)

**Local only. No deployment, production data access, Git push, or Apps Script publication.** Existing v1 working-tree changes and unrelated `docs/connector-region-policy.md` were preserved.

The shared evaluator now supports real READY outcomes from persisted evidence. New owner/admin configuration controls live inside the existing portfolio/report readiness panel. Provider account context and explicit client requirements are audited. Sheets/Looker retrievals mint scoped receipts only after authenticated complete retrieval; dataset corrections/configuration edits make receipts stale. No browser activation/receipt-create endpoint exists.

New files: `src/lib/reporting-context.ts`, `reporting-context-server.ts`, `report-delivery.ts`, `report-readiness-context.test.ts`, `report-readiness-evidence.pg.integration.test.ts`; `src/app/api/reports/readiness/configuration/route.ts`; `src/components/reports/ReportingConfiguration.tsx`; migration `prisma/migrations/20260904160000_reporting_evidence/migration.sql`; [evidence contract and live certification gaps](./REPORT_READINESS_EVIDENCE.md).

Extended existing files: shared evaluator/loader/DTO, readiness panel and browser tests, warehouse query (scoped client plus transaction support), Meta/Google/TikTok metadata and TikTok currency ingestion, Sheets/Looker authenticated endpoints and Apps Script configuration, Prisma schema and tenant-guard model registry. Legacy client readiness still delegates to the same evaluator.

### Migration evidence

- Applied the additive migration to loopback PostgreSQL database `monstera_security_test` on port 55439.
- Prisma schema comparison returned **empty migration**: no schema drift.
- Composite FK tests reject wrong-workspace connection/context and client/receipt relationships.
- Existing data is not backfilled with guessed timezone/currency or requirements.

### Current verification

- Full unit/PostgreSQL suite: **657 passed, 0 failed, 0 skipped** (`context-all-final.log`). Includes membership/role boundaries, provider/override audits, exact-window receipts, both required destinations, data correction/configuration invalidation, timestamp staleness, failed/empty/filtered/paginated retrievals, audience binding and atomic receipt/audit rollback.
- Production build: passed in isolated temporary copy, outbound HTTP blocked (`context-build-final.log`). No deployment.
- Typecheck passed (`context-types-final.log`). Lint passed with **0 errors / 56 existing warnings**, threshold unchanged (`context-lint-final.log`).
- Full desktop/mobile browser suite: **44 cases completed — 42 first-pass, 2 passed on retry** (`context-browser-final.log`). All new readiness/configuration cases passed first time. Existing mobile `/login` and invalid-invitation navigations timed out waiting for page load once, then passed. No assertion or timeout was weakened. An earlier full run passed all 44 without retries before the final card-layout-only change.
- Screenshot review: owner configuration, read-only configuration and stale receipts render on desktop/mobile; configuration stays open through readiness refresh, and expanding a client no longer forces all other client cards to its height. New browser assertion checks other cards remain compact. Screenshots: `app/test-results/*/reporting-configuration.png` and `reporting-stale-readonly.png` under the temporary evidence directory.
- Apps Script JavaScript syntax checks and `git diff --check` passed.
- Apps Script sources are local edits only; actual Google-hosted consumers remain unvalidated/unpublished.

Test environment and logs: `/private/tmp/monstera-security-pg.brfzdu/`. Local synthetic fixtures and whitelisted fake credentials only. The user's port 3000 preview process was not restarted or used for verification. Temporary browser servers stop after tests; the temporary PostgreSQL process was stopped after verification, with its local evidence retained. The first new browser run exposed form remounting during readiness refresh; configuration is now kept mounted while badges clear/revalidate. Initial test harness cleanup and TikTok metadata-call counting were corrected without weakening retry or production authorization rules.

### Still not live-certified

No real provider authorization, refresh, metric reconciliation, production metadata permissions, Google-side write/render acknowledgement, or Apps Script rollout was tested. Shopee/Lazada still need explicit reporting-semantics/context verification; missing metric currency cannot be repaired just by an override. Expected account/campaign rosters and zero-activity dates need operator reconciliation. High-volume latency and receipt retention need review. See the exact seven-item checklist in [REPORT_READINESS_EVIDENCE.md](./REPORT_READINESS_EVIDENCE.md).

## Historical v1 baseline (superseded where noted above)

Date: 2026-09-04. Base: `b3058da`. **Local only; not committed, pushed or deployed by this task.** No production data or configuration changed. Existing untracked `docs/connector-region-policy.md` is preserved and not part of this feature.

## Outcome

One server-side evaluator supports client portfolio badges, expandable provider/account evidence, selected-client Performance report readiness, GET single/portfolio reads, POST re-evaluation and the legacy client-scoped readiness adapter. All decisions are based on saved evidence; no AI or automatic source/report mutation. See [exact semantics and recovery](./REPORT_READINESS.md).

## Files changed

- `src/lib/report-readiness.ts`: shared DTO, stable codes/messages and pure rules.
- `src/lib/report-readiness-server.ts`: scoped, bounded, Repeatable Read database evidence loader.
- `src/lib/report-readiness-request.ts`: strict IDs/dates/window/pagination validation.
- `src/app/api/reports/readiness/route.ts`: authorized GET/POST.
- `src/lib/reporting-readiness.ts`, `src/app/api/workspaces/[id]/readiness/route.ts`: legacy client adapter and validation/error handling.
- `src/components/reports/ReportReadinessPanel.tsx`: shared badge, recovery and expandable evidence, scoped fetching.
- `src/app/(app)/clients/ClientsClient.tsx`: portfolio integration and 50-client paging.
- `src/components/reports/PerformanceReportDashboard.tsx`: selected-client readiness using the actual report window.
- `src/lib/report-readiness.test.ts`: deterministic rules/validation tests.
- `src/lib/report-readiness.pg.integration.test.ts`: real PostgreSQL/API/RBAC/sanitization tests.
- `tests/e2e/report-readiness.spec.ts`: desktop/mobile fixture and real client-report flow tests.
- `scripts/run-security-validation.mjs`: includes readiness in the focused clean-environment runner.
- `docs/implementation-plans/report-readiness-v1.md`, `docs/REPORT_READINESS.md`, this handoff, `docs/PRODUCT_ROADMAP_2026.md`, `docs/connector-readiness.md`: implementation plan, semantics and evidence posture.

## Database

No Prisma schema change or migration. Evaluations are computed from a consistent read-only snapshot, not stored. “Latest” is a fresh evaluation of currently saved evidence; there is no historical evaluation audit trail in v1.

## Verification results

| Gate | Result |
| --- | --- |
| Typecheck | Passed (`npm run typecheck`) |
| Lint | Passed (`npm run lint:ci`), 0 errors / 56 existing warnings; no threshold change |
| Full unit/PostgreSQL suite | **636 passed, 0 failed, 0 skipped** |
| New browser cases | 8 desktop/mobile cases passed, also included in the full suite |
| Full browser suite | **40 passed**, desktop/mobile, including registration, activation, tenant isolation and readiness |
| Production build | Passed in an isolated temporary copy, no deployment |
| Visual review | Desktop/mobile portfolio and selected-client report screenshots inspected; all statuses/evidence rendered, no horizontal overflow in readiness portfolio tests |
| Diff whitespace | Passed |

The local Postgres database was `monstera_security_test` on loopback port 55439. Tests used the repository's clean-environment runner and synthetic fixtures; no inherited database or provider credentials. Browser testing used a temporary app copy on port 3107, not the user's existing port 3000 preview. Build telemetry was disabled in that temporary copy. Outbound HTTP was blocked in the final build/browser runtime; expected mail-delivery failures in registration tests are not live delivery evidence.

The first combined browser run exceeded the application's existing per-identity login limit because new tests repeatedly signed in as Alice. The new UI test file now reuses its real authenticated session per worker. Production rate limits and feature flags were not weakened. The final full run passed without retries. A fixture typing error was also corrected before the final build.

Logs/screenshots are local temporary evidence under `/private/tmp/monstera-security-pg.brfzdu/` (`readiness-all-final.log`, `readiness-browser-full-final.log`, `readiness-build-final.log`, `readiness-types-final.log`, `readiness-lint-final.log`, `app/test-results/`). They are not portable deployment artifacts and may be removed by the operating system.

## Limitations / manual acceptance

1. Real datasets cannot currently be READY: normalized reporting timezone is absent; requirements are inferred from source assignments; client/window destination receipts are absent. Complete-evidence fixtures test the contract, not live certification.
2. Daily row presence does not reconcile totals or prove every expected account/campaign arrived. No-row zero-activity dates require manual reconciliation.
3. An operator must confirm the client's complete source/account roster, compare provider totals for identical dates/currency/timezone/conversion semantics, and retrieve that window from the intended destination.
4. Validate a representative real client's query size/latency before production rollout. The bounded loader fails conservatively when evidence exceeds 5,000 groups/records.
5. This is advisory only: existing exports/brief dispatch are not gated or modified, and no live provider, authorization, email or destination-delivery certification was performed.

## Next slice

Persist verified account reporting context and an independent required-source/account manifest, then add client/window retrieval receipts. This supplies the missing evidence before enabling real READY outcomes or adding durable evaluation history. Review locally, then obtain deployment approval separately.
