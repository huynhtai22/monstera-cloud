# HEARTBEAT.md - Automated Morning Routine & Reliability Monitor

# 3-Day Implementation Plan (Agent Tasks)
- [ ] DAY 1: VERIFY_DEPLOY_BASE: Run `vercel ls`. Confirm project linked. Alert if build environment missing any critical ENV variables (DATABASE_URL, NEXTAUTH_SECRET).
- [ ] DAY 1: VERTICAL_TEST: Verify `/dashboard` and `/api/auth` are reachable. Scan for any 500 errors in `tmp/` logs.
- [ ] DAY 2: SHEETS_SYNC: Audit `google-sheets-addon/` alignment with production API_BASE. Check if token exchange (OAuth) is logging any `401` errors in production logs.
- [ ] DAY 3: MARKETPLACE_GUARD: Scan `src/` for any missing trademark symbols (™) in user-facing copy. Verify `oauthScopes` parity between `appsscript.json` and GCP console.
- [ ] DAY 3: HERO_INGEST_HEALTH: Scan `tmp/` for ingestion errors on the primary path (e.g., TikTok/Shopee). Alert if error count > 5.

# Daily System Reliability Monitoring (The "Data Health Report")
- [ ] CHECK_DATA_VALIDATION: Query DB/Logs to count records ingested in last 24h. Flag any connection that ingested 0 records unexpectedly.
- [ ] CHECK_SYNC_LATENCY: Scan `tmp/` logs for jobs exceeding 15 minutes. Identify connection bottleneck.
- [ ] CHECK_API_ERRORS: Aggregate `tmp/*.log` errors by code (429, 401, 500). If > 5 errors of one type appear, provide a breakdown.

# !!! ROBERT'S STRATEGIC "NORTH STAR" FOR TOMORROW !!!
- [ ] REMINDER: You are NOT selling "Data Ingestion" (a cheap commodity); you are selling **"Data Infrastructure & Automated Reporting"** for agencies.
- [ ] REMINDER: **Pivot to Agency-First Growth.** One Agency client = 10+ SME clients, and drastically lower support burden per dollar earned.
- [ ] REMINDER: **Productize Support.** Every support ticket you answer is a failure of the product to explain itself. Prioritize "Self-Serve Health Reports" over new features.
- [ ] REMINDER: **Price for Profit.** 299k is a "hobby" price; 1.2M+ is an "Agency Value" price. Test the Agency Pilot program (e.g., 3M/month for 10 clients) before adding more SME tiers.

# Crypto Position Monitor
- [ ] BITGET_MONITOR: Every 2-4 hours, fetch position status. If PnL > target or < stop-loss, alert immediately.

# Manual Human Tasks to confirm/complete:
- Human: git init & .gitignore cleanup.
- Human: Environment variable checklist (Vercel).
- Human: Marketplace/OAuth checklist execution.
