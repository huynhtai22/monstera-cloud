# AGENTS

Guidance for autonomous agents working in this repo.

## Cursor Cloud specific instructions

- **Data explorer hub:** The synced metrics UI and warehouse import live on `/explorer` (`Warehouse & metrics` tab). The legacy route `/synced-data` redirects there. Navigation label: **Data explorer**.
- **Batch warehouse refresh:** UI calls `POST /api/data-explorer/warehouse/import-batch` with `{ workspaceId, since, until, items }` where each item is `{ connectionId, adAccountId? }`. **Meta** respects `since`/`until` per ad account. **Google Ads** and **TikTok** `syncConnectionData` now use the same `since`/`until` (clamped to plan via `clampTimeRangeToPlanMaxDays`). **Shopee** / **Lazada** ingest **daily order rollups** (order count + revenue) into `CampaignMetric` for the chosen window (`src/lib/sync-marketplace-warehouse.ts`). Duplicate non-Meta connection IDs in one batch are skipped after the first run.
- **Metrics query filters:** `GET /api/metrics/query` accepts `accountIds` (comma-separated) and still supports single `accountId` and `platform`. Distinct warehouse accounts for chips: `GET /api/metrics/accounts?workspaceId=`.
- **Auth middleware:** `/synced-data` and `/clients` are listed in `middleware.ts` so JWT session is required like other app routes.
- **Google ID tokens (Sheets add-on / Looker OAuth2):** production must set `GOOGLE_ID_TOKEN_AUDIENCES` (comma-separated OAuth client IDs) so backend routes that accept Google ID tokens can validate `aud` and fail closed if misconfigured.
- **Agency host routing:** See `src/lib/agency-host.ts`. Middleware rewrites eligible app paths on tenant hosts to `/agencies/[workspaceSlug]/…` (workspace slug must exist or layout 404). Env: `AGENCY_HOST_MAP` (JSON: hostname → slug), `AGENCY_ROOT_HOSTS`, `AGENCY_PRIMARY_DOMAIN_SUFFIX` (default `monsteracloud.com`), `AGENCY_DEV_SLUG` (for localhost), `AGENCY_ENABLE_VERCEL_PREVIEW` (`1` to rewrite on `*.vercel.app`). Successful rewrites set response header `x-monstera-agency-slug`.
- **CSP / security headers:** Defined on all routes in `next.config.mjs`. If a third-party endpoint fails in the browser, extend `Content-Security-Policy` intentionally (avoid widening back to unrestricted `https:` for `connect-src`).
- **Tenant scope helper:** `src/lib/workspace-scope.ts` merges mandatory `workspaceId` into Prisma `where` inputs and throws on conflicting tenant filters (application-layer isolation; Postgres RLS is not enabled).
- For standard dev commands (`npm run dev`, `npm run lint`, `npm run build`), see root `README.md` and `package.json`.
