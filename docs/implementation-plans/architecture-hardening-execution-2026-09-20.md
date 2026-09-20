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
- **Operations:** a shared 32+-character cron secret authenticates fleet jobs;
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
| P0 | GitHub CI and Vercel preview | In progress | All required checks succeed on the final commit |
| P0 | Preview browser/revocation smoke | Pending | Login, grace, revoke, 401 recovery, key rotate, and pin denial verified |
| P0 | Qualified ToS review | External | Counsel approves or revises the credential-sharing paragraph |
| P1 | Workspace-attributed device evidence | Not built | Heartbeat evidence carries an authorized workspace and never crosses tenants |
| P1 | Database-enforced tenant isolation | Not built | RLS policy/role rollout covers tenant tables and bypass roles are audited |
| P1 | Recoverable/idempotent key lifecycle | Partly built | Client retry cannot lose a newly rotated one-time secret after response loss |
| P1 | Dedicated telemetry/pin salt rotation | Operational | Stable `LOGIN_IP_SALT` is set; rotation/versioning procedure is documented |
| P1 | Disaster-recovery proof | Operational | Encrypted backup restore is rehearsed with measured RPO/RTO |
| P1 | Scoped scheduler credentials | Not built | Compromise of one job token cannot invoke every cron route |
| P2 | Security observability/SLOs | Not built | Alerts exist for auth failure spikes, pin rejection spikes, cron failure, and retention lag |
| P2 | CI supply-chain policy | Partial | Secret scan, dependency/SBOM review, SAST, and protected required checks are enforced |

## Today versus later

Today closes the P0 code defects and can complete CI plus preview smoke testing.
RLS, scoped scheduler identities, backup/restore proof, and eight-week H1/H2
measurement are separate risk-reduction projects; treating them as same-day
checkboxes would create unsafe, unverified changes. OTP step-up, owner revokes
member sessions, a console banner, and device fingerprinting remain explicitly
deferred until measurement justifies them.
