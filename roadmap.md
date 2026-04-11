# Monstera Cloud Roadmap

## Budget / Platform constraints

### Cron scheduling for 4-hour refresh (all customers)
- **Problem**: Vercel Hobby only supports **daily** Cron schedules. Anything like `0 */4 * * *` or `* * * * *` is blocked.
- **Impact**: We **cannot** run `/api/cron/sync-jobs` every 4 hours for all users purely via Vercel Cron on Hobby.
- **Options**:
  - **Option A (simplest)**: Upgrade to **Vercel Pro** and set Cron to `0 */4 * * *` (or keep every-minute worker + per-pipeline cadence).
  - **Option B (no upgrade)**: Keep hosting on Vercel, but use an **external scheduler** (GitHub Actions / Upstash QStash / cron-service) to call `https://monsteracloud.com/api/cron/sync-jobs` every 4 hours with `Authorization: Bearer $CRON_SECRET`.
  - **Option C**: Migrate scheduled jobs to another platform (more ops overhead).

## Next up
- **Looker Studio connector**: publish the community connector (Apps Script) so testers can add it as a data source using a workspace API key.

