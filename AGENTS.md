# AGENTS

Guidance for autonomous agents working in this repo.

## Cursor Cloud specific instructions

- **Data explorer hub:** The synced metrics UI and warehouse import live on `/explorer` (`Warehouse & metrics` tab). The legacy route `/synced-data` redirects there. Navigation label: **Data explorer**.
- **Batch warehouse refresh:** UI calls `POST /api/data-explorer/warehouse/import-batch` with `{ workspaceId, since, until, items }` where each item is `{ connectionId, adAccountId? }`. Meta respects `since`/`until` per account; Google Ads and TikTok use `syncConnectionData` (default window in code, not the UI dates). Duplicate non-Meta connection IDs in one batch are skipped after the first run.
- **Metrics query filters:** `GET /api/metrics/query` accepts `accountIds` (comma-separated) and still supports single `accountId` and `platform`. Distinct warehouse accounts for chips: `GET /api/metrics/accounts?workspaceId=`.
- **Auth middleware:** `/synced-data` and `/clients` are listed in `middleware.ts` so JWT session is required like other app routes.
- For standard dev commands (`npm run dev`, `npm run lint`, `npm run build`), see root `README.md` and `package.json`.
