# Engineering delivery roadmap

The authoritative product position, Now / Next / Later phases, and release gates are in [docs/PRODUCT_ROADMAP_2026.md](./docs/PRODUCT_ROADMAP_2026.md). This file intentionally retains tactical hosting and reliability notes.

## Platform reliability

- [x] External 15-minute worker while staying on Vercel Hobby.
  - GitHub Actions workflow `.github/workflows/pilot-cron.yml` curls `/api/cron/warehouse-jobs`, token prefetch, Shopee refresh, and `/api/cron/health-tick`.
  - Required GitHub secret: `CRON_SECRET` (same value as production). Optional repo variable: `CRON_BASE_URL` (defaults to `https://monsteracloud.com`).
  - Import UI tells the truth: queued jobs are not implied to be running; recovery is “within about 15 minutes,” not seconds.
- [ ] Upgrade Monstera Cloud to Vercel Pro before promising faster-than-15-minute async import recovery to external customers.
  - Current status: internal pilot on Vercel Hobby (daily Vercel cron + GitHub Actions 15-minute curl worker).
  - Reason: Hobby supports only daily native cron; the Actions worker is the budget substitute.
  - Production target: use a minute-level queue worker to promptly resume expired or queued PostgreSQL import jobs.

## Blocked product proof

- **TikTok GMV Max reporting (Shop-scoped):** Blocked on missing TikTok Shop `store_id`. Prototype remains on unmerged branch `feat/tiktok-gmv-max-sandbox` (PR #126). See Phase 5 in [docs/PRODUCT_ROADMAP_2026.md](./docs/PRODUCT_ROADMAP_2026.md#phase-5--regional-advantage).
