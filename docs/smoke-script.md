# Monstera Cloud — smoke script (≈15 min)

**Use when:** Before inviting beta users, after every production deploy you care about, or at 2AM when something “feels off.”  
**Base URL:** `https://monsteracloud.com` (change if you’re on a preview).  
**Record:** Deployment ID / git SHA: `________________` Date: `________________`

**Rules**

1. Run in a **fresh incognito window** (or a dedicated test account).
2. Mark each step **PASS** / **FAIL** / **SKIP** (SKIP = optional or blocked by env).
3. If any **required** step fails, **stop** and fix or roll back before expanding the test surface.

---

## Flow A — Auth spine (session + redirect)

| Step | Action | Expected (factual) | Result |
|------|--------|-------------------|--------|
| A1 | Open `https://monsteracloud.com` | Page loads; nav shows **Log in**, **Start free** | |
| A2 | Click **Log in** | URL is `/login`; heading **Log in to Monstera Cloud**; **Continue with Google** visible | |
| A3 | Wrong password submit | Red message: **Invalid email or password** | |
| A4 | Sign in with **valid** credentials (email or Google) | Redirect to **`/console`** (unless `callbackUrl` is set—then that path) | |
| A5 | Open `/login` again while signed in | Brief spinner, then redirect away from login (session recognized) | |
| A6 | Sidebar footer: open profile chevron → **Log out**; then open `/console` | Redirect to sign-in (or console shows **Failed to load data sources** with **Sign in**—acceptable when logged out) | |

**Time target:** A1–A6 under **3 minutes** on normal wifi.

---

## Flow B — Data Sources (core console)

| Step | Action | Expected (factual) | Result |
|------|--------|-------------------|--------|
| B1 | While signed in, open `https://monsteracloud.com/console` | **H1:** `Data Sources`; subcopy about connect and manage platforms | |
| B2 | See **Connected sources:** row with a number | Number matches count of connected sources (0 is OK) | |
| B3 | Click **Refresh All** | List reloads without permanent error state | |
| B4 | On an **Available** card (e.g. **Meta Ads**), click **Connect** | Modal opens; for Meta, step 1 title **Sign in with Facebook** | |
| B5 | Close modal (X); in **Search integrations…** type `Meta` | List filters to matching cards | |
| B6 | Tabs **All Sources** / **Connected** / **Available** | Switching tabs changes the list logically | |
| B7 | *(Optional)* Header **New Data Source** only | Modal opens (first visit often defaults to Shopee authorize copy—OK) | **SKIP** if redundant after B4 |

**Time target:** B1–B6 under **5 minutes**.

---

## Flow C — API keys + Looker API (programmatic path)

| Step | Action | Expected (factual) | Result |
|------|--------|-------------------|--------|
| C1 | Open `https://monsteracloud.com/settings` | Settings layout loads; sidebar includes **Workspace**, **API Keys**, etc. | |
| C2 | Click **API Keys** | **H3:** `Developer API Keys`; copy about programmatic access / Sheets add-on | |
| C3 | Click **Generate Key** | Banner **Key Generated Successfully** and **Please copy this value now.**; list updates after | |
| C4 | **Terminal** — replace `YOUR_KEY` (use the key from C3 or an existing test key): `curl -sS -o /tmp/mc-ping.json -w "%{http_code}" -H "Authorization: Bearer YOUR_KEY" "https://monsteracloud.com/api/looker-studio?ping=1"` | Exit code 0; printed code **`200`**; `/tmp/mc-ping.json` contains `"ok":true` | |
| C5 | Same key, data probe (adjust dates): `curl -sS -H "Authorization: Bearer YOUR_KEY" "https://monsteracloud.com/api/looker-studio?startDate=2026-01-01&endDate=2026-01-31"` | HTTP **200**; JSON has top-level **`data`** array (may be empty) | |
| C6 | Click **Revoke** on the test key *(if you created one for this run)* | Key disappears; repeat C4 → **401** | **SKIP** if you reused a long-lived key |

**Time target:** C1–C5 under **5 minutes** (C6 optional).

---

## Quick triage (if something fails)

| Failed step | Check first |
|-------------|-------------|
| A3–A4 | `NEXTAUTH_SECRET`, DB, Vercel logs for `/api/auth/*` |
| B1 | Session cookie; middleware; `GET /api/workspaces` in Network tab (status + body) |
| C4–C5 | Same `curl` from your laptop vs server; API route deploy; `DATABASE_URL` |
| C5 empty `data` | Normal if no `CampaignMetric` rows for that workspace + range—not an API bug |

---

## Sign-off

| | |
|--|--|
| Flows A + B + C (required steps) | ☐ All PASS |
| Blockers logged (ticket / note) | `________________` |
| Next run scheduled | `________________` |

---

*Keep this file aligned with UI copy when headings or routes change.*
