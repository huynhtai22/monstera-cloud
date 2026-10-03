# AGENTS

Guidance for autonomous agents working in this repo.

## Cursor Cloud specific instructions

- **Node.js version**: this repo requires **Node >= 22**. The PostCSS nesting toolchain is ESM-only and does not build correctly on Node 20. If `npm run dev` complains about Node version, upgrade Node before running anything.
- **Database**: the app expects a **PostgreSQL** `DATABASE_URL`. For local/Cloud Agent verification, a simple local Postgres is sufficient, then run `npx prisma db push` (see `README.md`).

- **Linting (Next.js 16)**: `next lint` is removed in Next.js 16, so lint is run via `npm run lint` (ESLint CLI). The command is scoped to `src/` to avoid linting non-app tooling directories.

- **Core “hello world” for this repo** (warehouse/data explorer):
  - Create the smoke user: `npm run create-smoke-user:pro`
  - Seed demo warehouse rows: `npm run seed-demo-metrics`
  - You can sanity-check warehouse rows via SQL on table `"CampaignMetric"`.

- **Data explorer hub:** The synced metrics UI and warehouse import live on `/explorer` (`Warehouse & metrics` tab). The legacy route `/synced-data` redirects there. Navigation label: **Data explorer**.

- **Batch warehouse refresh:** UI calls `POST /api/data-explorer/warehouse/import-batch` with `{ workspaceId, since, until, items }` where each item is `{ connectionId, adAccountId? }`. **Meta** respects `since`/`until` per ad account. **Google Ads** and **TikTok** `syncConnectionData` now use the same `since`/`until` (clamped to plan via `clampTimeRangeToPlanMaxDays`). **Shopee** / **Lazada** ingest **daily order rollups** (order count + revenue) into `CampaignMetric` for the chosen window (`src/lib/sync-marketplace-warehouse.ts`). **Shopee** also runs a **best-effort** `v2.ads` pull (`get_all_cpc_ads_daily_performance` → granular `CampaignMetric` per campaign/ad via `src/lib/shopee-ads-mapper.ts` + `src/lib/sync-shopee-ads-warehouse.ts`). Access-token expiry uses `access_token_obtained_at` (`src/lib/shopee-credential-utils.ts`); fleet cron: `src/app/api/cron/shopee/refresh/route.ts`. Until Partner Center enables Ads APIs, that step no-ops or logs warnings without failing order sync. Set `SHOPEE_ADS_SYNC=false` to disable ads pulls only. Duplicate non-Meta connection IDs in one batch are skipped after the first run.

- **Metrics query filters:** `GET /api/metrics/query` accepts `accountIds` (comma-separated) and still supports single `accountId` and `platform`. Distinct warehouse accounts for chips: `GET /api/metrics/accounts?workspaceId=`.

- **Auth middleware:** `/synced-data` and `/clients` are listed in `middleware.ts` so JWT session is required like other app routes.

- **Google ID tokens (Sheets add-on / Looker OAuth2):** production must set `GOOGLE_ID_TOKEN_AUDIENCES` (comma-separated OAuth client IDs) so backend routes that accept Google ID tokens can validate `aud` and fail closed if misconfigured.

- **Agency host routing:** See `src/lib/agency-host.ts`. Middleware rewrites eligible app paths on tenant hosts to `/agencies/[workspaceSlug]/…` (workspace slug must exist or layout 404). Env: `AGENCY_HOST_MAP` (JSON: hostname → slug), `AGENCY_ROOT_HOSTS`, `AGENCY_PRIMARY_DOMAIN_SUFFIX` (default `monsteracloud.com`), `AGENCY_DEV_SLUG` (for localhost), `AGENCY_ENABLE_VERCEL_PREVIEW` (`1` to rewrite on `*.vercel.app`). Successful rewrites set response header `x-monstera-agency-slug`.

- **CSP / security headers:** Defined on all routes in `next.config.mjs`. If a third-party endpoint fails in the browser, extend `Content-Security-Policy` intentionally (avoid widening back to unrestricted `https:` for `connect-src`).

- **Tenant scope helper:** `src/lib/workspace-scope.ts` merges mandatory `workspaceId` into Prisma `where` inputs and throws on conflicting tenant filters (application-layer isolation; Postgres RLS is not enabled).

- **Shopee `Wrong sign` / environment separation:** Signing uses `partner_id + api_path + timestamp` with HMAC-SHA256 over the raw key (UTF-8). Sandbox always uses **`SHOPEE_TEST_PARTNER_ID` + `SHOPEE_TEST_PARTNER_KEY`** and **`https://openplatform.sandbox.test-stable.shopee.sg`**; production always uses **`SHOPEE_LIVE_PARTNER_ID` + `SHOPEE_LIVE_PARTNER_KEY`** and **`https://partner.shopeemobile.com`**. Generic `SHOPEE_PARTNER_*` aliases are intentionally unsupported. `SHOPEE_SANDBOX` is truthy for `true` / `1` / `yes` / `on` (case-insensitive). The legacy sandbox host `partner.test-stable.shopeemobile.com` often returns `Wrong sign` for correct keys — do not switch back without re-verifying. The sole production callback is exactly `https://monsteracloud.com/api/auth/callback?provider=shopee`.

- **Shopee JSON payloads:** Many endpoints return tokens or entities under a top-level **`response`** object. `src/lib/shopee.ts` unwraps that for token exchange, refresh, and signed GETs so `access_token` and shop payloads are not misread; failures use **`error`** (non-empty string), not **`message`** alone.

- **Shopee / Lazada OAuth `state`:** If the redirect omits `state`, `/api/auth/callback` can still complete when the user has a session: it attaches the new connection to the user’s **most recently updated owned workspace**, else the oldest member workspace. Prefer fixing redirect URL length / Shopee app config so `state` is preserved when possible.

- **`/sources/setup`:** `GET /api/connections/[id]` returns `{ connection, pipelines, recentLogs }`. The setup client must read **`data.connection`** (not the whole JSON). After OAuth, it also **syncs `activeWorkspaceId`** to `connection.workspaceId` so the connection appears under **Your sources** for the same workspace the row was stored in.

- **Hobby cron:** Vercel only runs `/api/cron/master` daily. The GitHub Actions workflow `.github/workflows/pilot-cron.yml` curls `/api/cron/warehouse-jobs`, `/api/cron/connections/token-prefetch`, `/api/cron/shopee/refresh`, and `/api/cron/health-tick` every 15 minutes. Stale pipeline evaluation lives on health-tick (not on `/api/cron/sync-jobs`, which is 410 in pilot). Production GitHub secret `CRON_SECRET` must match the app secret.

- **Shopee Push callback:** `POST /api/webhooks/shopee` (and `GET` returns `200 ok` for probes). Shopee signs **`Authorization`** or **`x-shopee-signature`** as **hex HMAC-SHA256(secret, request body)** (header may include a `SHA256 ` prefix; we try **wire body** and **compact `JSON.stringify(JSON.parse(body))`**). The primary secret is the same explicit TEST or LIVE Partner Key selected by `SHOPEE_SANDBOX`, then optional **`SHOPEE_PUSH_VERIFICATION_KEY`** (Push screen “Test Push Partner Key” when it differs from the API key). Non-2xx fails Partner Center verification.

- **App shell / click-through:** On large screens, `AppLayout` uses a **full-width** `lg:sticky` top strip for `NotificationCenter` (`z-20`) above `main` (`z-10`). That strip must use `pointer-events-none` on the row and `pointer-events-auto` on the bell control only; otherwise empty flex space overlaps scrolling page content and **intercepts clicks** (e.g. setup wizard CTAs, links).

- For standard dev commands (`npm run dev`, `npm run lint`, `npm run build`), see root `README.md` and `package.json`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
