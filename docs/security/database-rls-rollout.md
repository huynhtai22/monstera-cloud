# Database row-level security rollout

`src/lib/tenant-guard.ts` remains the active application-layer control. The
repository also contains an RLS policy generator and integrated reporting
transaction contexts, but production activation is intentionally staged: enabling
`FORCE ROW LEVEL SECURITY` against today's pooled owner connection would deny
legitimate queries and fleet jobs.

## Local proof

```bash
RLS_REHEARSAL_CONFIRMATION=LOCAL_DISPOSABLE_ONLY \
bash scripts/rehearse-tenant-rls.sh
```

The rehearsal migrates a disposable PostgreSQL 16 database, discovers every
`workspaceId` table (including nullable ownership) from the catalog, installs the policy, switches
to a non-owner/non-bypass role, and proves same-tenant read, unscoped denial,
and cross-tenant write rejection.

Latest repository verification: **2026-09-20**, disposable PostgreSQL 16;
same-tenant read returned one row, an unscoped read returned zero rows, and a
cross-tenant insert was rejected.

## Implemented next slice

- Root Workspace rows, every direct workspace model, and child-only tables
  (SyncLog, SyncCheckpoint, SyncJob, TransformationRule, SyncLogDetail,
  ShopeeCatalogSyncState, SchemaVersion) have explicit policies.
- Both USING and WITH CHECK are enforced. A restrictive policy prevents a
  different permissive policy widening tenant access. Tenant-parent foreign
  keys are checked for visible ownership, including legacy single-column FKs.
- Nullable workspace rows are system-only until attached to a workspace.
- Warehouse reads, standalone readiness evaluation, authenticated delivery
  retrieval, and Operations delivery evaluation set transaction-local context.
  Existing RepeatableRead and timeout/maxWait settings are preserved. Callers
  already inside a transaction must pass it through; helpers reject nesting.
- `DATABASE_RLS_ENFORCED=1` makes these tenant helpers reject owner/superuser,
  BYPASSRLS, system-role membership, missing RLS, or missing restrictive fences.
  It is a verification guard, **not** a policy installer or global rollout flag.
- A real LOGIN/NOBYPASSRLS role is tested using raw SQL (not merely Prisma
  filters), a one-connection pool, rollback, two-hop child access, cross-tenant
  reparenting, forged system flags, and deliberately overbroad permissive policy.

Run against an explicitly disposable `monstera_ci` database, after migrations:

```bash
CLIENT_ASSIGNMENT_TEST_DB=1 NODE_ENV=test \
npx tsx --test src/lib/database-tenant-context.pg.integration.test.ts
```

The test installs policies in that disposable database and creates/drops its
own test role. It requires an administrative local test connection. Never run
it against durable databases. Runtime test grants are intentionally broad to
prove RLS; they are NOT a production least-privilege grant template.

## Remaining before global activation

Identity and authentication tables (User, Account, Session, UserSession,
LoginEvent, VerificationToken, PasswordResetToken) and the global
DashboardTemplate catalog are explicitly outside workspace RLS. They need
separate least-privilege identity/catalog access, not tenant-role blanket grants.
Workspace discovery and membership authorization run before a tenant is chosen:
these paths need a narrowly scoped identity bridge before root Workspace and
WorkspaceMember policies can be enabled in the application.

Other Operations sections, blueprint publication/open/list APIs, OAuth,
invitation acceptance, billing webhooks, connector workers and fleet crons
still have unconverted queries. They must not share a tenant role until each
unit of work sets context; fleet bypass must use a separate credential and an
audited operation. No automatic bypass is inferred from application system
scope, no owner-connection fallback is permitted, and auth failure must not
be hidden by weakening RLS.

The GUC is trusted application context, NOT proof of user membership. The API
must authorize membership before selecting a workspace. RLS protects against
missing/wrong query predicates, not arbitrary SQL injection that sets a new
tenant GUC. A compromised runtime credential is a separate security boundary.

Production activation is still **not approved** by this local implementation.
Do not apply the policy SQL or change production credentials as part of a
routine deploy. This slice does not alter migrations or migration checksums.

### Verification for this slice

- Fresh disposable PostgreSQL 16: all 32 existing migrations applied.
- 83 PostgreSQL tests passed, zero skips: 7 restricted-role tests plus
  Operations, blueprint publication/concurrency, and warehouse snapshot tests.
- 31 focused unit tests passed. Typecheck and production build passed.
- Lint: zero errors, 68 existing warnings.
- Standalone SQL rehearsal passed, including authorized system role access
  and denial of a tenant-forged system flag.
- No production access, role rotation, policy activation, push or deployment.

## Production activation gate

1. Create a non-owner, `NOBYPASSRLS` runtime role with least-privilege grants;
   retain a separately controlled owner role for migrations only.
2. Migrate each tenant request path to `withDatabaseTenantContext`. Migrate
   fleet jobs to the narrow `withDatabaseSystemContext`; record every bypass
   invocation in the operations audit stream.
   The system connection must use a separately controlled role that is a
   member of `monstera_system` (NOLOGIN, NOBYPASSRLS). Never grant that membership
   to the tenant runtime role: the system GUC alone no longer grants bypass.
3. Run the full tenant suite using the runtime role, including OAuth,
   webhooks, cron, billing, reporting, and nested-relation tables.
4. Apply `scripts/tenant-rls-policy.sql` in a non-production environment and
   run browser and connector regression suites.
5. Rotate production `DATABASE_URL` to the runtime role, apply the policies,
   verify denial probes, and keep the owner URL outside application runtime.
6. Only then consider `FORCE ROW LEVEL SECURITY`; Prisma migrations must keep
   using the owner role.

Until steps 1–5 have evidence, database enforcement is **prepared, not
activated**. This is a deliberate safety boundary, not a completed control.
