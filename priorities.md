# Monstera Cloud — product priorities

The authoritative product strategy and phase gates are in [docs/PRODUCT_ROADMAP_2026.md](./docs/PRODUCT_ROADMAP_2026.md). This file retains the useful engineering-priority context that supports that strategy; it is not a competing product roadmap. Technical scheduling and hosting constraints stay in [roadmap.md](./roadmap.md).

---

## 1. Reliable ingestion and trust *(initialized)*

**Outcome:** Users and operators trust that data arrived completely, on time, and that failures are honest and actionable.

### Principles

- **Observable:** Every pipeline has a clear last sync time, row movement, and status path (success / partial / failed).
- **Actionable errors:** Messages distinguish credential issues, rate limits, schema drift, and destination write failures—not a generic “sync failed.”
- **Idempotent where it matters:** Re-runs don’t duplicate or corrupt destination state; cursors and job state are consistent after crashes.
- **Alert signal:** Notifications (Telegram, email) fire on real problems, not on noise.

### Checklist — foundation

- **Pipeline run path** — `/api/pipelines/[id]/run` records every completed attempt: **success** logs include `rowsSynced` (including 0) and `durationMs`; **error** logs include `durationMs`, classified `errorMsg`, and JSON `code`/`tag` for clients (`src/app/api/pipelines/[id]/run/route.ts`). Removed the blanket **Google OAuth before ETL** gate so extract can run; Google is only required when rows are actually loaded to Sheets.
- **Connection surface** — Successful runs call `markConnectionsSyncedOk`; failures call `markConnectionsSyncError` (`src/lib/ingestion/connection-sync-state.ts`). Console prefers `**connection.lastSyncAt`** for “last sync” when set (`src/app/(app)/console/page.tsx`).
- **Actionable errors** — `classifyIngestionError` + `formatLogError` tag auth / quota / network / source / destination (`src/lib/ingestion/error-taxonomy.ts`).
- **Health semantics** — `Pipeline.healthStatus` and `lastSyncedAt` stay aligned with logs (healthy vs stale vs error). Stale evaluation runs on `/api/cron/health-tick` (15-minute GitHub Actions worker + nightly master). `/api/cron/sync-jobs` stays 410 in pilot.
- **Cron worker** — Hobby substitute is `.github/workflows/pilot-cron.yml` every 15 minutes (`roadmap.md`). Vercel native cron remains nightly via `/api/cron/master`.

### Checklist — trust extras

- **Rate limiting** — API routes that trigger heavy work respect existing middleware / limits (`src/middleware.ts`, `src/lib/ratelimit.ts`).
- **Secrets & rotation** — Encrypted credentials; clear UX when OAuth or API keys expire.
- **Demo vs real** — Demo/mock overlays are visibly labeled so slides never pass as production data (`demoMockMode` and UI banners).

### Code anchors (for implementation)


| Area                              | Location                                            |
| --------------------------------- | --------------------------------------------------- |
| Reliability pillars (typed)       | `src/lib/ingestion/reliability.ts`                  |
| Error classification              | `src/lib/ingestion/error-taxonomy.ts`               |
| Connection last sync / last error | `src/lib/ingestion/connection-sync-state.ts`        |
| Pipeline run + logs               | `src/app/api/pipelines/[id]/run/route.ts`           |
| Scheduled jobs                    | `src/app/api/cron/sync-jobs/route.ts`               |
| Stale health tick                 | `/api/cron/health-tick`, `src/lib/ingestion/stale-health.ts` |
| Hobby 15-minute worker            | `.github/workflows/pilot-cron.yml`                  |
| Alerts                            | `src/lib/alerts.ts`, cron email alerts              |
| Health aggregation                | `src/app/api/workspaces/[id]/health-stats/route.ts` |


---

## 2. Test and learn — find failures fast *(midnight debugging)*

**Outcome:** When something breaks, you can answer **which pipeline**, **which step**, and **which error** without guessing.

### Target checklist

- **Single “runs” view** — Data Explorer, Sources, and source setup show warehouse jobs + pipeline logs via `GET /api/runs` (`src/components/runs/RunsView.tsx`).
- **Copy-pasteable diagnostics** — Each row copies workspace/run/connection/pipeline ids and the error tag.
- **Failure taxonomy** — Tags `[auth]` / `[quota]` / `[network]` / `[source]` / `[destination]` with reconnect vs retry vs wait-quota. Telegram/email only for auth, exhausted retries, and stale > 26h.

### Code anchors


| Area               | Location                           |
| ------------------ | ---------------------------------- |
| Sync logs (schema) | `prisma/schema.prisma` → `SyncLog` |
| Pipelines API      | `src/app/api/pipelines/`           |
| Overview activity  | `src/app/(app)/overview/page.tsx`  |


---

## 3. Looker Studio integration

**Outcome:** Report-ready metrics via workspace API key; community connector publishable and maintainable.

### Target checklist

- **API contract stable** — `GET /api/looker-studio` auth, date range, platform filter; production smoke tests pass.
- **Connector package** — Apps Script project deployed; manifest and optional default template per `scripts/looker-studio-connector/SUBMISSION-CHECKLIST.md`.
- **Submission** — PSCC requirements, OAuth verification, demo video recorded per `scripts/looker-studio-connector/MOCKUP-TEST.md`.

### Code anchors


| Area              | Location                             |
| ----------------- | ------------------------------------ |
| Connector scripts | `scripts/looker-studio-connector/`   |
| Backend route     | `src/app/api/looker-studio/route.ts` |


---

## Order of execution

1. **Reliable ingestion** (this doc §1) — foundation.
2. **Observability / midnight debugging** (§2) — builds on honest logs and errors.
3. **Looker Studio** (§3) — polish when the pipe is boringly reliable.

---

*Last updated: P1 tenant safety — provider allowlist on write paths, Prisma workspace guard, two-tenant e2e.*
