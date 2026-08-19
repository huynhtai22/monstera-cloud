# Roadmap

## Platform reliability

- [x] External 15-minute worker while staying on Vercel Hobby.
  - GitHub Actions workflow `.github/workflows/pilot-cron.yml` curls `/api/cron/warehouse-jobs`, token prefetch, Shopee refresh, and `/api/cron/health-tick`.
  - Required GitHub secret: `CRON_SECRET` (same value as production). Optional repo variable: `CRON_BASE_URL` (defaults to `https://monsteracloud.com`).
  - Import UI tells the truth: queued jobs are not implied to be running; recovery is “within about 15 minutes,” not seconds.
- [ ] Upgrade Monstera Cloud to Vercel Pro before promising faster-than-15-minute async import recovery to external customers.
  - Current status: internal pilot on Vercel Hobby (daily Vercel cron + GitHub Actions 15-minute curl worker).
  - Reason: Hobby supports only daily native cron; the Actions worker is the budget substitute.
  - Production target: use a minute-level queue worker to promptly resume expired or queued PostgreSQL import jobs.
