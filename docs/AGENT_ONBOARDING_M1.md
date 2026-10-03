# M1: persistent onboarding foundation

Implemented and verified locally on 2026-09-30. This milestone creates the durable foundation for the approved onboarding flow. It does not yet replace the current onboarding UI or connect a live provider.

## Implemented

- Six work categories, optional bounded context, and a timestamp for selection or deliberate skip. Preferences belong to the signed-in user and never change application permissions.
- Workspace/user-owned onboarding runs with an optional workspace-scoped client. A server-generated resume key prevents duplicate setup runs, including after completion. Changing the client while resuming is rejected.
- Provider tasks, connection links, bounded messages, and ordered events. Composite foreign keys enforce workspace consistency for runs, clients, tasks, connections, events, and import-job references.
- Serializable transactions commit state changes and event sequence increments together. Optimistic versions reject stale writes. Run/task creation and identical message replay are idempotent; reusing a message identifier with different content is rejected.
- An explicit task transition graph, preparation/recovery operations, pause/resume, and validated connection binding. Import/verification/readiness transitions reject execution until M3 supplies real job/evidence checks.
- Membership and initiating-user checks inside services, viewer write restrictions, tenant-guard coverage, sanitized API errors, and paginated event snapshots with separate delivered cursor and high-water mark.

## API surface

All new routes require `ENABLE_AGENT_ONBOARDING=1` and an authenticated session. With the flag absent, they return 404 in every environment. Set the flag only after applying the migration and generating Prisma Client in the intended development/test environment.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/me/work-profile` | Read the caller's work preferences. |
| `PATCH /api/me/work-profile` | Save `{ category, context? }`; category accepts the six `WorkCategory` values or null for skip. |
| `POST /api/agent/runs` | Create/resume with `{ kind: "onboarding", workspaceId, clientId? }`; 201 for new, 200 for resumed. Returns a scoped snapshot. |
| `GET /api/agent/runs/[runId]?afterSequence=0` | Read the caller's run, task/link facts, latest 50 messages, and up to 100 ordered events. Continue with `nextSequence` while `hasMoreEvents` is true. |

Task creation, message persistence, pause/resume, transitions, and connection binding are shared service functions under `src/lib/agent/`; public coordinator/action routes arrive in M2. The UI must not set task success or run completion directly.

## Migration and verification

Migration: `prisma/migrations/20260930000000_agent_onboarding_foundation/migration.sql`. It adds enums, nullable user fields, five workflow tables, indexes and foreign keys, plus a composite import-job identity. It does not rewrite source credentials or warehouse rows.

Verified on Node 22.23.2 with Prisma 5.22.0 and isolated PostgreSQL 17:

- Prisma schema validation and client generation pass.
- Applied the migration to a database created from the pre-M1 schema; the resulting schema diff is empty.
- Full project TypeScript check passes.
- ESLint passes for the new agent services, tests and API routes.
- 18 targeted tests pass, zero skipped, including 10 real-PostgreSQL tests. Coverage includes concurrent run/task/message requests, conflicting mutations, workspace and same-run relational isolation, API authentication/input validation, profile ownership, pause/resume, reauthorization recovery, and event pagination beyond 100 events.

Type/lint checks and the final test run used an exact working-source copy outside iCloud with dependencies from the current lockfile because dependency reads in the workspace stalled. Dependencies and package manifests in the working repository were not changed by this workaround. The PostgreSQL migration/tests used a disposable local database; production has not been modified.

To repeat the targeted tests, use a disposable PostgreSQL database with the current schema and Node >=22:

```sh
npx prisma generate
npx tsx --test src/lib/agent/contracts.test.ts src/lib/agent/persistence.pg.integration.test.ts src/lib/tenant-guard-schema.test.ts src/lib/tenant-guard.test.ts
```

Provide `DATABASE_URL` and `DIRECT_URL` for that disposable database. The PG suite fails rather than silently skipping an unavailable database in CI. Follow the repository migration/baseline procedure for existing environments; applying this local test migration is not a production deployment.

## M2 handoff

Build the full-screen role and connector screens against these APIs, implement the bounded coordinator/tool registry, and add authenticated action routes. Preserve task card identity and cursor-based event replay while applying the approved visual/motion treatment. The coordinator must return structured next actions when no real specialist execution is available. M3 then connects TikTok authorization, account confirmation, durable import and warehouse evidence to this foundation.
