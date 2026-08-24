# Agency pilot operations

## Release sequence

1. Rehearse the migration against a production-like snapshot and confirm Prisma reports no unexpected drops or drift.
2. Confirm all legacy connection credentials are encrypted before enabling code that rejects plaintext.
3. Run CI gates and connector contract tests for every enabled provider.
4. Run the dependency preflight checklist (below) whenever a release touches security, auth, rate limiting, or any external dependency.
5. Deploy three internal tenants, then five design partners, then expand to no more than twenty agencies.
6. Deploy from `origin/main` with `npm run deploy:prod`, or allow the gated main-branch workflow to deploy. Both paths stamp the immutable build SHA and attach Git metadata.
7. After the production alias changes, compare `/api/version` with the intended commit and schema migration. Require `commitSource: build`; a different source means release provenance is not trustworthy.

## Dependency preflight checklist

The August 2026 Upstash incident shipped correct code against an unreachable external dependency; users hit `503 limiter_unavailable` before any monitor did. Run this before deploying releases that touch security, auth, rate limiting, or external integrations:

1. **Env presence at the target scope** — every variable the release reads exists with the right environment scope (`vercel env ls`, names/scopes only). A var saved only to Preview will be absent in Production.
2. **Live reachability probe** — unauthenticated `GET https://monsteracloud.com/api/looker-studio` returns **401** (auth evaluated past the limiter), never **503** (`limiter_unavailable`). Any 503: stop and follow [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md) Runbook 1 by `failureCategory`.
3. **Cron secret pairing** — repository secret `CRON_SECRET` matches the production app env so the GitHub Actions pilot cron keeps returning 200.
4. **Redeploy after env changes** — saved variables apply only to new deployments.

Pause expansion immediately for a confirmed tenant leak, data corruption, or sustained connector failure. Revoke affected API keys and OAuth credentials, preserve audit evidence, and notify affected pilot owners through the agreed incident channel.

## Hobby scheduler

Vercel Hobby only runs `/api/cron/master` once a day. Production also needs the GitHub Actions workflow **Pilot cron** (`.github/workflows/pilot-cron.yml`) so warehouse job recovery, token prefetch, Shopee refresh, and stale-health evaluation run about every 15 minutes.

1. Add repository secret `CRON_SECRET` with the same value as production `CRON_SECRET`.
2. Optionally set repository variable `CRON_BASE_URL` if the production origin is not `https://monsteracloud.com`.
3. Confirm a `workflow_dispatch` run returns HTTP 200 for each path before relying on the schedule.

Do not promise import recovery faster than that interval.

## Required monitors

Operational readiness requires timestamped production evidence under
[OPERATIONS_ACCEPTANCE.md](./OPERATIONS_ACCEPTANCE.md); this list describes
what to observe but is not itself proof of alert delivery, restore readiness,
or retention ownership.

- OAuth attempts by provider and failure code, especially invalid/reused state.
- First import completion and time-to-first-row.
- Queued/running job age and exhausted retries.
- Workspace freshness from `lastSyncAt`, latest successful job, and warehouse `asOf`.
- API error rate, tenant authorization failures, and connector error rate.
- Invitation creation/acceptance and API-key issue/revoke audit events.

## Connector certification

Each enabled provider must pass OAuth, account discovery, first import, token refresh, manual refresh, nightly refresh, expired-token recovery, and visible freshness/error state. Lazada, Amazon, Shopify, and TikTok Shop remain disabled until the same checklist passes.

## Rollback

Use the previous Vercel deployment for application rollback. Database migrations are forward-only: restore only from a verified snapshot after incident review. Never run destructive Prisma reset commands against pilot or production data.
