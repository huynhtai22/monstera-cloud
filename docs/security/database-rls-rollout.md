# Database row-level security rollout

`src/lib/tenant-guard.ts` remains the active application-layer control. The
repository now also contains an RLS policy generator and a transaction-local
context helper, but production activation is intentionally staged: enabling
`FORCE ROW LEVEL SECURITY` against today's pooled owner connection would deny
legitimate queries and fleet jobs.

## Local proof

```bash
RLS_REHEARSAL_CONFIRMATION=LOCAL_DISPOSABLE_ONLY \
bash scripts/rehearse-tenant-rls.sh
```

The rehearsal migrates a disposable PostgreSQL 16 database, discovers every
required `workspaceId` table from the catalog, installs the policy, switches
to a non-owner/non-bypass role, and proves same-tenant read, unscoped denial,
and cross-tenant write rejection.

Latest repository verification: **2026-09-20**, disposable PostgreSQL 16;
same-tenant read returned one row, an unscoped read returned zero rows, and a
cross-tenant insert was rejected.

## Production activation gate

1. Create a non-owner, `NOBYPASSRLS` runtime role with least-privilege grants;
   retain a separately controlled owner role for migrations only.
2. Migrate each tenant request path to `withDatabaseTenantContext`. Migrate
   fleet jobs to the narrow `withDatabaseSystemContext`; record every bypass
   invocation in the operations audit stream.
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
