# Monstera Cloud agency pilot

Monstera Cloud is an invitation-only, multi-tenant data warehouse for agencies. Agency staff connect certified advertising and marketplace sources, import normalized metrics, inspect freshness in Data Explorer, and query the same warehouse through Google Sheets, Looker Studio, or a workspace API key. Clients are organizational records; they are not login identities or security tenants.

## Pilot scope

- Shared Monstera domain; agency-host routing is disabled unless explicitly enabled outside the pilot.
- Certified providers: Meta Ads, Google Ads, TikTok Ads, and Shopee. Lazada and other catalog sources remain unavailable.
- Manual refresh and one nightly warehouse refresh. Scheduled destination pushes and public checkout are deferred.
- Workspace-owned plans and provider allowlists are assigned by a platform operator.
- Credentials are AES-256-GCM encrypted. Normalized campaign metrics and selected raw payload fields are stored in PostgreSQL.

## Local setup

Requirements: Node.js 20.9 or newer, npm, and PostgreSQL 16.

```bash
npm ci
cp .env.example .env
npx prisma migrate deploy
npm run dev
```

Required production secrets include `DATABASE_URL`, a 32+ character `NEXTAUTH_SECRET`, a 64-hex-character `ENCRYPTION_KEY`, a 32+ character `CRON_SECRET`, and `GOOGLE_ID_TOKEN_AUDIENCES`. Provider credentials are documented in `.env.example`.

For local smoke data:

```bash
npm run create-smoke-user:pro
npm run seed-demo-metrics
```

Production disables demo seeding, mock/debug/sandbox routes, legacy OAuth entry points, Stripe, LemonSqueezy, and Xendit. Paddle code is retained for later but requires `ENABLE_PADDLE_BILLING=1` and is not part of pilot acceptance.

## Provisioning

1. Set an internal user’s `platformRole` to `OPERATOR` using a controlled database operation.
2. Sign in and open `/pilot-admin`.
3. Enter agency name, unique slug, owner email, plan, and enabled providers.
4. Send the seven-day invitation URL to the owner through an approved channel.
5. The workspace and owner membership are created atomically when the owner accepts.
6. Owners/admins invite additional agency staff from Settings → Team.

## Database deployment

Fresh databases apply the full migration history with `npx prisma migrate deploy`.

The repository now contains a baseline because the earlier migration history assumed tables already existed. For an existing production database, rehearse on a snapshot, verify that it already matches the pre-pilot Prisma schema, and mark only the baseline as applied before deploying:

```bash
npx prisma migrate resolve --applied 20260401000000_baseline
npm run encrypt-connection-credentials:dry-run
npm run encrypt-connection-credentials
npx prisma migrate deploy
npx prisma migrate status
```

Do not mark the pilot tenancy migration as applied: it backfills workspace entitlements, provider access, OTP controls, OAuth attempts, invitations, audit events, and hashed API keys.

## Release gates

```bash
npm run typecheck
npm run lint:ci
npm test
npm run build
npm audit --omit=dev --audit-level=critical
```

CI also applies and checks migrations against PostgreSQL. Playwright covers the critical public/protected shell and is run after the production build. After deployment, `/api/version` must show the intended commit SHA and schema version.

See [pilot operations](docs/PILOT_OPERATIONS.md), [privacy and data handling](docs/PILOT_DATA_HANDLING.md), and [smoke script](docs/smoke-script.md).
