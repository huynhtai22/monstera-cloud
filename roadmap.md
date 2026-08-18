# Roadmap

## Platform reliability

- [ ] Upgrade Monstera Cloud to Vercel Pro before offering asynchronous warehouse imports to external customers.
  - Current status: internal pilot on Vercel Hobby.
  - Reason: Hobby supports only daily cron execution, so a timed-out background import may not recover until the nightly sweep.
  - Production target: use a minute-level queue worker to promptly resume expired or queued PostgreSQL import jobs.
  - Until upgraded: keep async imports internal-pilot only; do not promise production-grade recovery timing.
