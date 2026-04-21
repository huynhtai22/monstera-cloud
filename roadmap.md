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

---

## Product Strategy: Two Distribution Models

### Background
We currently support two ways users consume Monstera Cloud data:

| | Type A — Connector-first | Type B — Console-push |
|---|---|---|
| Entry point | Google Sheets Add-on / Looker Studio Connector | Monstera Console |
| How it works | User installs add-on, authorizes sources from the sidebar, pulls data on demand | User connects sources + destination in console, Monstera pushes data on a schedule automatically |
| Who configures the destination? | The user, inside Google Sheets or Looker Studio | The user, inside the Monstera Console (Destinations page) |
| Infrastructure required | Low — runs in user's browser session | High — requires background job scheduler, token refresh management, retry queues |
| Current status | ✅ In progress (submitted to marketplace) | 🔲 Not yet built |

---

## Phase 1 (Now) — Validate with the Add-on

- Get the Google Sheets Add-on and Looker Studio Connector approved and live
- Grow the connector user base (Type A)
- The Monstera Console = token management + billing surface for these users
- **Signal to watch:** Users saying *"I wish this just updated automatically without me clicking Refresh"* → that is the demand signal for Type B

---

## Phase 2 (When we have 50+ active connector users) — Scheduled Console Push

### What it is
The user connects a Google Sheets destination inside the Monstera Console. Monstera's backend pulls from Meta/TikTok/Shopee on a user-defined schedule (daily / every 4h) and **writes rows directly to their sheet** without the add-on being open.

### Why it matters
- This is the **"set it and forget it"** premium feature — the natural upsell from free connector user → paid plan
- Supermetrics was built entirely on this model → $50M ARR, $830M valuation
- Every company running >$10K/month in ads needs automated reporting; manual exports don't scale

### Market validation

| Competitor | Model | ARR / Scale |
|---|---|---|
| **Supermetrics** | Meta/Google Ads → Sheets/Looker scheduled push | $50M+ ARR, $830M valuation |
| **Funnel.io** | Marketing data aggregation → BI tools | $40M+ ARR |
| **Porter Metrics** | Ads data → Looker Studio | Profitable, growing |
| **DataSlayer / Adveronix** | Ads → Sheets connectors | Established, profitable |

Price point in market: **$99–$299/user/month**

### Our differentiation — the SEA moat
Supermetrics does not cover **Shopee, Lazada, or TikTok Shop** well. Every Shopee seller / TikTok Shop merchant tracking performance data is doing it manually today or patching together spreadsheet formulas. That is a real, underserved gap — no well-resourced competitor is filling it.

We are not competing with Supermetrics globally. We are **Supermetrics for SEA** — a meaningfully underserved niche with strong platform network effects (Shopee, Lazada, TikTok Shop all have growing seller bases).

### Technical feasibility

**Fully feasible.** We already have:
- ✅ Source API connections (Meta, TikTok, Google Ads, Shopee, Lazada)
- ✅ OAuth token management
- ✅ Google Sheets OAuth scope in the destination connector
- ✅ Pipeline runner

Remaining work:
- [ ] Robust job scheduler (Upstash QStash or upgrade to Vercel Pro cron)
- [ ] Google OAuth refresh token storage + rotation
- [ ] Write-to-range logic for Sheets (append rows, handle header row)
- [ ] Rate limit queue per user per source
- [ ] Error notification (email / in-console alert when a scheduled sync fails)

**Estimated: 3–5 weeks for a solid v1.**

### Business model alignment

| Tier | Feature |
|---|---|
| **Free** | Use the Google Sheets Add-on / Looker Connector — pull on demand |
| **Starter / Pro** | Scheduled console push — data updates automatically every day |
| **Growth** | Multiple destinations, higher sync frequency (every 4h), multi-workspace |

> The **Destinations page** in the console is the configuration UI for the paid scheduled push feature.
> Keep it — but frame it as a power feature, not a mandatory onboarding step for add-on users.

---

## Console UX implications (implemented)

- **Pipelines pillar card**: pipelines form automatically — removed the broken `/pipelines` CTA
- **Dashboard D7 warning**: fires when no destination is connected (future: suppress for add-on-only users)
- **Setup wizard**: should eventually offer a skip path for connector-first users who don't need a console destination
- **Destinations page**: should clarify in the header that this page is for scheduled push automations, not required for add-on users
