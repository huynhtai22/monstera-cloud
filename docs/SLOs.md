# Service level objectives & alert routing

Operational targets for pilot, each mapped to the signal that measures it and the path an alert takes. Reviewed monthly; targets tighten before GA.

Telemetry reality (documented so nobody hunts for ghosts): this app runs on Vercel serverless, where classic APM agents do not operate. The working signals are **Sentry** (errors, wired server/edge/client), **synthetic external checks** (`synthetic-checks.yml`, every 15 min), **GitHub Actions cron history** (`pilot-cron.yml`), and **Vercel runtime logs**. The New Relic account exists but receives nothing by design — revisit if the project moves off Hobby or adopts a long-running runtime.

| # | SLO | Target | Measured by | Alert route |
|---|-----|--------|-------------|-------------|
| 1 | External availability | ≥ 99% of 15-min probes pass over 30d | Synthetic checks | Failed run → Actions email + `::error::` annotations → Runbook 1 |
| 2 | External dependency health (Upstash limiter) | `/api/looker-studio` returns 401 (never 503) on every probe | Same probe #2 | Same as #1 → Runbook 1 decision table |
| 3 | Application errors | No untriaged *critical* Sentry issue older than 24h; new-issue review daily during pilot | Sentry issues (server/edge/client) | Owner enables Sentry Alert Rule "New issue in production" → email (2-min UI step, see below) |
| 4 | Cron freshness | pilot-cron succeeds every scheduled tick; no two consecutive failures | Actions run history | Consecutive failures → Actions email; investigate via Runbook quick-reference |
| 5 | Sync freshness | Every connected workspace's newest `lastSyncAt` within plan interval × 2 | `health-tick` staleness marking + console UI | Stale connections surface in console; escalate per connector-readiness docs |
| 6 | Data durability | Restore drill executed at least quarterly; backups restorable into app-compatible state | Drill evidence in LAUNCH_READINESS_AUDIT.md | Calendar reminder (owner); first completed 2026-08-23 |
| 7 | AI worker freshness | Nightly `/api/cron/master` task `agentJobs` succeeds and drains up to 3 due `analyst_turn` jobs; remaining queue age ≈ 24h | Sentry + `emitMonitor("ai_worker_failed")` on `/api/cron/agent-jobs` | Not SLO #4 (`pilot-cron.yml`). Optional `pilot-ai-cron.yml` is a later, separate Actions alert |
| 8 | Credential attack signal | Fewer than 20 failed credential logins in any 15m window | `SecurityControlEvent` + `/api/cron/security-posture` | Non-200 scheduled run + `auth_failure_spike` monitor |
| 9 | Pinned-key rejection signal | Fewer than 5 rejected pinned-key calls in any 15m window | `SecurityControlEvent` + `/api/cron/security-posture` | Non-200 scheduled run + `api_key_pin_rejection_spike` monitor |
| 10 | Security cron health | No recorded child-cron failure in the last 30m | master cron control events + security-posture evaluator | Non-200 scheduled run + `cron_failure` monitor |
| 11 | Security retention freshness | Last successful bounded cleanup is no older than 26h | retention control event | Non-200 scheduled run + `retention_lag` monitor |

## One manual step remaining (#3 alert rule)

In **sentry.io** → project **Settings → Alerts → Create Alert**: type *"a new issue is created"* in environment **production**, send to owner's email. Two minutes; no code. Until enabled, #3 is measured but not actively pushed.

## Deliberately not wired

- **New Relic policies**: account is empty and the serverless runtime cannot host its agent. Creating conditions against absent data would be false assurance. Key retained in `.env.newrelic` (gitignored) for the post-HA/replatform decision.
- **Latency percentiles**: no APM spans exist; synthetic probe durations serve as the coarse proxy until a real decision is made.

## Security-posture rollout

`pilot-cron.yml` invokes retention before `/api/cron/security-posture`. Each
route has its own credential. A breach returns 503 so GitHub Actions supplies
the first alert route; Vercel logs also receive a named `[MONITOR]` event. This
is code-complete but not operationally accepted until the owner proves a
scheduled failure reaches the named recipient and records the evidence under
`docs/OPERATIONS_ACCEPTANCE.md`.
