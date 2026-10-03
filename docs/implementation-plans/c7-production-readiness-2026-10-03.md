# C7 production readiness — 2026-10-03

Status: **release deployed; pilot activation pending**. This record does not certify a live provider, approve a workspace cohort, or enable monitoring/recovery.

## Verified release

| Item | Evidence |
| --- | --- |
| Public application | https://monsteracloud.com |
| Production commit | `d9bbd55d9cbc49b7aaf521dae2b6f00241d50c15` (merge of PR #206) |
| Tested implementation commit | `f570c711843f000f66b8f3e67903725d7b0c1e69` |
| Production deployment | `dpl_3sjGUQ6TqwuPRGEWEtpCdGTLDyMa`, READY, production alias attached |
| Deployment workflow | https://github.com/huynhtai22/monstera-cloud/actions/runs/37073894693 — success |
| Version endpoint | `/api/version` reports the production commit, `commitSource: build`, build time `2026-10-02T22:43:09.212Z`, and expected schema version |
| Schema version | `20261001020000_agent_console_c2_event_sequence_counter` |
| Migration execution | Deployment log confirms all three C2 migrations applied successfully before the build |
| Release validation | PR #206 CI: 2,298 Node tests and 166 full browser checks passed. Additional local focused verification: 105 tests and 54 desktop/mobile checks |

Version metadata identifies the built schema version; the successful migration step independently establishes that the production migration process completed. No direct production database inspection was performed for this record.

## Observed gates

- Unauthenticated `GET /api/agent-console/summary` returns HTTP 404 with `Agent console is disabled`, matching the server feature gate.
- Unauthenticated `GET /api/agent-console/cron` returns HTTP 401; no authenticated dispatch or provider import was initiated during this audit.
- Production environment inventory contains no `ENABLE_AGENT_CONSOLE`, `ENABLE_AGENT_CONSOLE_MONITORING`, `ENABLE_AGENT_CONSOLE_WORKER`, `AGENT_CONSOLE_WORKSPACE_IDS`, or `CRON_SECRET_AGENT_CONSOLE` entries. This is a configuration inventory observation, not authenticated confirmation of every runtime gate.
- GitHub repository variables do not enable the dedicated agent-console job; the scoped `CRON_SECRET_AGENT_CONSOLE` repository secret is absent. The latest scheduled run records `agent-console-tick` as skipped.
- The intended customer responsibility cadence is daily. The workflow requests 15-minute dispatcher ticks; actual cadence, capacity, and the 60-minute scheduled-check SLO are not certified.
- No runtime error clusters were returned for `/console`, `/api/agent-console/summary`, and `/api/agent-console/cron` in the selected one-hour window. This limited observation does not prove end-to-end availability or lack of errors elsewhere.

## Operational blockers observed before pilot

Scheduled workflow: https://github.com/huynhtai22/monstera-cloud/actions/runs/37107985302 (2026-10-03).

| Observation | Meaning and required closure |
| --- | --- |
| Warehouse cron HTTP 500: 5 jobs processed, 2 terminal failures, no recorded infrastructure-stage failures | The worker ran, but some imports failed. Separate expected customer reconnect outcomes from infrastructure defects, reconcile each outcome, and establish that an approved pilot account can complete and verify its import |
| Health tick HTTP 500: health evaluation completed; alert delivery reported retry/dead-letter outcomes | Do not interpret this as proof that health evaluation never ran. Diagnose alert delivery independently and demonstrate operational visibility before pilot |
| Provider runtime errors include revoked/missing credentials and legacy unencrypted credential payloads | Certify only an explicitly authorized account with valid encrypted credentials; any legacy credential repair needs a scoped plan and verification. Do not weaken decryption checks or invent provider success |
| Some provider errors include credential text in log messages | Redact provider error messages before persistence/logging, test with synthetic credential fixtures, and have the authorized operator reconnect/rotate the affected grant. No credential values are included in this record |

The runtime error-cluster query included historical first-seen dates. Counts must not be presented as exact events during a single 24-hour period. Shared-worker failures do not by themselves establish a regression caused by PR #206.

## Remaining acceptance sequence

1. Designate one provider, workspace, exact account IDs, authorized operator, rollout owner, and test window. Do not infer ongoing execution consent from OAuth or onboarding completion.
2. Close credential/logging blockers for the selected account and reconcile a disclosed live import against provider UI/API: accounts, dates, currency/timezone, metric semantics, outcome, and actual data-through coverage. Unknown semantics stay unknown.
3. Rehearse authenticated feature/cohort exclusions, duplicate dispatch, lost leases, expired authorization, changed scope, stale evidence, partial imports, scheduler outage/catch-up, and pause/rollback in an isolated deployment. Synthetic failures remain separate from live certification.
4. Record actual scheduler/worker capacity and cadence on the deployed build. Verify cases cannot close without current scoped coverage.
5. After the live journey and rehearsal pass, configure matching scoped cron secrets and independent app/workflow gates, then enable one approved workspace and one responsibility. Begin assisted operation; unattended recovery requires the customer's explicit bounded policy and its own verified acceptance.
6. Measure due/completed/delayed checks, useful/noisy findings with denominators, recovery attempts/verified outcomes, time saved, and opt-outs. Expand only after trust and measured value gates pass.

No production flags, secrets, grants, jobs, or customer data were modified by this audit. Campaign/budget writes and external report delivery remain outside C7. The other agent's unfinished pilot changes and PRs #207/#208 were not included in this release.
