# Tenant Safety Audit

**Scope:** draft PR #50, `feat/harden-reliability-security-release`  
**Purpose:** release gate for the internal, two-workspace pilot. This is not a certification for public self-service launch.

## Enforcement rules

- **RBAC:** authenticated session plus `requireWorkspaceAccess`. Role floor is `viewer` for reads, `member` for normal operational changes, and `admin`/`owner` for privileged changes.
- **Scoped query:** authenticated identity (session, Google ID token, or API key) is included in the database query together with `workspaceId`. This is appropriate for connector protocols that cannot use browser sessions.
- **User scope:** resource belongs to the authenticated user rather than a workspace.
- **System:** a cron secret, signed provider webhook, or operator role is required. These are not browser-user endpoints.
- **Disabled:** returns a fixed 404/410/503 response and does not access tenant data.

No route may accept a caller-supplied workspace ID as its only authorization proof.

## Audited application and connector routes

| Route(s) | Ownership | Guard |
|---|---|---|
| `/api/workspaces`, `/api/workspaces/[id]`, `/connections`, `/health-stats`, `/invitations`, `/members`, `/test-telegram` | Workspace | RBAC; membership management is admin-only, admin grants are owner-only. |
| `/api/clients` | Workspace | RBAC plus `{ id, workspaceId }` on mutation. |
| `/api/connections`, `/api/connections/[id]`, `/accounts`, `/assign-client`, `/status`, `/sync`, `/reconnect`, `/shopify/auth-url` | Workspace connection | RBAC or membership-scoped connection lookup. Connection deletion, account selection, assignment, and sync timestamp writes include workspace scope. OAuth reconnect stores the workspace in a one-time attempt. |
| `/api/pipelines`, `/api/pipelines/[id]/run`, `/api/sync-logs` | Workspace pipeline | RBAC/membership-scoped pipeline lookup. Pipeline source and destination must belong to the selected workspace. Interactive runs require member access; cron runs require the cron secret. |
| `/api/data-explorer/warehouse/import`, `/import-batch`, `/jobs/[id]`, `/query` | Workspace warehouse | RBAC and `{ connectionId, workspaceId }` or job workspace lookup before query, import, and polling. |
| `/api/data-explorer/meta-accounts` | Workspace connection | Connection is resolved first, then RBAC is enforced against its immutable `workspaceId`. |
| `/api/data-explorer/upload`, `/query` | Authenticated user dataset | Dataset object IDs are prefixed with the authenticated user ID; cross-user IDs return 403. This is intentionally user-scoped, not shared-workspace storage. |
| `/api/metrics/accounts`, `/platforms`, `/query`; `/api/dashboard/summary`; `/api/attribution/snapshots`; `/api/debug/campaign-metrics` | Workspace metrics | Session membership/RBAC and `workspaceId` filtering on every metric and snapshot query. Debug data is production-disabled unless explicitly enabled. |
| `/api/dashboard-templates` | Workspace dashboard | RBAC: viewers can list applicable templates; members are required to create a dashboard instance. |
| `/api/settings/data-quality`; `/api/settings/api-keys`; `/api/settings/demo-metrics` | Workspace configuration | RBAC. Data-quality and API-key updates/deletes use `{ id, workspaceId }`; API-key secrets are only returned once at creation. |
| `/api/export/rows` | API-key workspace | Hashed API key resolves one workspace; source lookup is always constrained by that workspace. |
| `/api/looker-studio`, `/accounts`, `/meta`, `/jobs/[id]` | API-key or Google-token workspace | API key is workspace-bound. Google ID token must resolve to a membership in the requested workspace. Job polling is constrained by job ID, API-key ID, and workspace. `/jobs` is disabled during pilot. |
| `/api/v1/sheets/auth`, `/connections`, `/query`, `/schema`; `/api/addon/auth`, `/accounts` | Google ID-token workspace | Google token audience verification, then membership-scoped workspace/connection/query lookup. Schema catalog is intentionally public and contains no tenant data. |
| `/api/google-ads/accounts`, `/report`; `/api/meta-ads/accounts`, `/report`, `/report/[reportRunId]`; `/api/tiktok-business/report/create`, `/report/[taskId]`, `/sandbox-connect`, `/sandbox-seed`; `/api/shopee/orders`, `/products`, `/shop-info` | Workspace connection | Session plus connection lookup restricted to workspaces the user belongs to. Provider requests use credentials from that scoped connection only. Sandbox endpoints are pilot/development tools. |
| `/api/ai/performance-summary` | Workspace metrics | RBAC before constructing any model context. Feature is disabled in production unless explicitly enabled. |
| `/api/user`, `/user/plan`, `/api/google-sheets/list` | Current user / selected workspace | Current session only; selected workspace plan uses RBAC. |
| `/api/internal/pilot/workspaces`, `/api/admin/ops-stats` | Platform operations | Authenticated `OPERATOR` platform role, not general workspace membership. |
| `/api/auth/connect`, `/api/auth/callback` | OAuth attempt | Start requires RBAC. Callback requires the signed, one-time, expiring OAuth attempt plus the same logged-in user; reconnect uses `{ id, workspaceId, provider }`. |
| `/api/auth/[...nextauth]`, `/register`, `/verify`, `/resend-otp`, `/forgot-password`, `/reset-password` | Identity | Authentication/account recovery only; no workspace data is selected from caller parameters. |
| Legacy provider OAuth authorize/callback paths | Disabled | Return 410; unified OAuth routes above are the only active flow. |
| `/api/invitations/[token]` | Invitation | Token hash, expiry, one-time acceptance, and invited-email match. The public GET reveals only a redacted email hint. |
| `/api/checkout/*`, `/api/xendit/checkout` | Billing | Authenticated checkout creation and provider-generated metadata; no cross-workspace resource lookup by a browser user. Pilot billing routes may be feature-disabled. |
| `/api/integrations/config`, `/api/version` | Public configuration | No tenant data or credentials are returned. |
| `/api/report-schedules`, `/api/looker-studio/jobs`, `/api/settings/api-keys/reveal*`, `/api/stripe/webhook`, `/api/webhooks/lazada` | Disabled | Fixed response; no tenant data path during pilot. |
| `/api/mock/shopee/orders` | Demo | Production-disabled; requires bearer header in non-production. No persisted tenant data. |

## Audited system and webhook routes

| Route(s) | Guard | Notes |
|---|---|---|
| `/api/cron/master`, `/connections/token-prefetch`, `/performance-alerts`, `/report-schedules`, `/shopee/refresh`, `/sync-jobs`, `/warehouse-jobs`, `/warehouse-refresh`, `/meta-keep-alive` | `CRON_SECRET` via constant-time bearer comparison | Fails closed when the secret is absent or shorter than 32 characters. These workers intentionally process multiple workspaces and are not callable by tenant users. |
| `/api/webhooks/paddle` | Paddle signature | Workspace plan changes are derived from verified provider data. |
| `/api/webhooks/lemonsqueezy` | Lemon Squeezy signature | User plan changes are derived from verified provider data. |
| `/api/xendit/webhook` | Xendit callback token | User plan changes are derived from verified provider data. |
| `/api/webhooks/shopee` | HMAC-SHA256 signature plus Redis idempotency | Upstream shop deauthorization can remove matching Shopee connections. This is an upstream account event, not a browser-user action. |

## Automated evidence

- `src/app/api/settings/data-quality/data-quality-route.test.ts` verifies 401, viewer denial, and workspace-scoped PATCH/DELETE handler behavior.
- `src/lib/warehouse-import-job.pg.integration.test.ts` verifies durable queue claims, idempotency, lease fencing, and workspace isolation with real PostgreSQL in CI.
- `src/lib/tenant-isolation.pg.integration.test.ts` creates Alice/Workspace A, Bob/Workspace B, and a viewer in real PostgreSQL. It verifies cross-workspace denial and that connections, pipelines, sync logs, data-quality rules, warehouse jobs, API keys, Looker jobs, and scoped mutations cannot escape Workspace A.

## Remaining pilot risks

1. **Route coverage is a release gate, not a substitute for a live acceptance test.** Before inviting pilot users, create two real accounts and workspaces. Attempt the documented cross-workspace URLs and mutations with browser sessions, expecting 403 or 404 every time.
2. **User-uploaded CSV datasets are user-owned rather than workspace-shared.** Keep this behaviour during the pilot; add a workspace-owned dataset model before exposing shared uploads to teams.
3. **Vercel Hobby queue recovery is daily.** Asynchronous warehouse imports remain internal-pilot-only until Vercel Pro enables the minute-level worker described in `ROADMAP.md`.
4. **Provider account sharing remains an operational decision.** Do not connect the same advertising or shop account to separate pilot workspaces unless that relationship is deliberate and documented.
