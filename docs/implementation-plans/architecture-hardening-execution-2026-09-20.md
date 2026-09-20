# Architecture hardening execution — 2026-09-20

## Current trust boundaries

- **Identity:** NextAuth JWT sessions, with revocation and device allowance
  state persisted in `UserSession`. Edge proxy remains JWT-verification-only;
  Node route/session callbacks enforce revocation and fail open on session
  infrastructure failure.
- **Tenancy:** application-layer Prisma guard requires `workspaceId` on direct
  tenant models. PostgreSQL row-level security is not enabled, so raw-client,
  system-scope, and exempt-model code remain privileged trust boundaries.
- **Data plane:** provider connections write normalized warehouse facts to
  PostgreSQL; connector leases/fencing and report publication use transactional
  and advisory-lock patterns for important concurrent workflows.
- **External delivery:** Google identity tokens use an audience allowlist;
  workspace API keys are hashed at rest, revocable, capped, rotatable, and may
  be pinned to an office network.
- **Operations:** the Vercel master retains one high-privilege secret while
  each child job uses its own 32+-character scoped credential;
  migrations, retention, billing expiry, connector health, and report dispatch
  are orchestrated through cron routes.

## Execution table

| Priority | Control | Status | Exit criterion |
|---|---|---|---|
| P0 | Exact concurrent session ceiling | Done locally | Concurrent PostgreSQL test ends at the configured hard limit |
| P0 | Atomic API-key cap/create/rotate/revoke/pin + audit | Done locally | Cap and mutation share one workspace advisory transaction |
| P0 | IP pin on every bearer-key endpoint | Done locally | No application route imports the low-level key resolver |
| P0 | Tenant privacy for sharing signals | Done locally | Tenant admins receive no user-global login/IP/UA aggregation |
| P0 | Migration/schema drift | Done locally | Fresh migrate-deploy followed by Prisma migrate-diff is empty |
| P0 | GitHub CI and Vercel preview | Passed on `94131a8` | All required checks succeed on the final commit |
| P0 | Preview browser/revocation smoke | Pending | Login, grace, revoke, 401 recovery, key rotate, and pin denial verified |
| P0 | Qualified ToS review | External | Counsel approves or revises the credential-sharing paragraph |
| P1 | Workspace-attributed device evidence | Done locally | Heartbeat evidence carries an authorized workspace and never crosses tenants |
| P1 | Database-enforced tenant isolation | Prepared, not activated | Disposable RLS proof passes; production runtime-role cutover and bypass audit remain |
| P1 | Recoverable/idempotent key lifecycle | Done locally | Client retry replays one encrypted 24-hour receipt instead of creating another key |
| P1 | Dedicated telemetry/pin salt rotation | Code + runbook done | Production must set independent salts and record the active versions |
| P1 | Disaster-recovery proof | Passed locally | Disposable encrypted backup/restore passed with a canary and zero schema drift; production-derived restore still needs named authority/approver |
| P1 | Scoped scheduler credentials | Code done; configuration pending | Configure every production/GitHub scoped secret and keep legacy fallback disabled |
| P2 | Security observability/SLOs | Code done; delivery pending | Security-posture cron fails on auth/pin/cron/retention breach; verify notification delivery |
| P2 | CI supply-chain policy | Workflow done; protection pending | Security workflow passes and its checks are required by branch protection |

## Today versus later

The repository now contains the safe code and disposable rehearsals for every
listed engineering control. Production RLS activation, secret installation,
alert-delivery proof, a production-derived restore, branch-protection changes,
and qualified legal review remain evidence gates; code cannot truthfully
complete them. OTP step-up, owner revokes member sessions, a console banner,
and device fingerprinting remain explicitly deferred until measurement
justifies them.
