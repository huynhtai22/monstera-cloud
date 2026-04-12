# Mockup / dry run — before recording for the community team

Use this as a **rehearsal script**. Run through it once without recording; fix any issues; then record the screencast Google asks for.

---

## 0) What you need


| Item                    | Notes                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workspace API key**   | Monstera Cloud → Settings (or wherever keys are issued). The connector stores it as KEY auth.                                                          |
| **Campaign data**       | At least some `CampaignMetric` rows for the workspace in the date range you’ll pick, or the report will look empty (still OK for auth/schema demo).    |
| **Apps Script project** | `scripts/looker-studio-connector/` pushed to Apps Script; **Deploy** → **Test deployment** (or a versioned deployment) and copy the **deployment ID**. |
| **Browser**             | Logged into the Google account that owns the Apps Script project (for “Develop” connector testing).                                                    |


---

## 1) Backend smoke test (2 minutes)

Confirm the API accepts your key **before** opening Looker Studio.

Replace `YOUR_API_KEY` with a real key:

```bash
# Fast auth check (no campaign query — same as connector credential validation)
curl -sS -H "Authorization: Bearer YOUR_API_KEY" \
  "https://monsteracloud.com/api/looker-studio?ping=1"
```

- Expect **HTTP 200** and `{"ok":true}`.

```bash
# Data for a range (Looker sends YYYY-MM-DD; both styles work)
curl -sS -H "Authorization: Bearer YOUR_API_KEY" \
  "https://monsteracloud.com/api/looker-studio?startDate=2026-01-01&endDate=2026-12-31"
```

- Expect **HTTP 200** and JSON with a `data` array (may be empty).
- Without a key: **401** — proves the route is live.

Optional: append `&platform=meta_ads` to the data URL to match the connector’s platform filter.

---

## 2) Connector dry run in Looker Studio (mockup — no recording)

Do this **exact sequence** so the real recording matches muscle memory.

1. Open [Looker Studio](https://lookerstudio.google.com/) → **Create** → **Report**.
2. **Add data** → **Browse connectors** → find **Monstera Cloud** (or **Explore connectors** → your community connector by name).
  - If you only deployed to **yourself**, use **Develop** / **Build** flow for your deployment ID (per Google’s community connector dev docs).
3. When prompted for credentials: paste the **API key** → connect.
4. In connector config: leave **Platform** = **All** (or pick one platform) → **Connect** / **Continue**.
5. In the field picker: add at least **Date**, **Campaign Name**, **Spend**, **Impressions** (or your preferred set).
6. Add a simple chart (e.g. table or time series with **Date** and **Spend**).
7. Set a **date range** that includes days you know have metrics.
8. Confirm: **no auth errors**, chart renders (or empty state if no rows).

**Failure checklist**

- **Invalid credentials** → key wrong or revoked; confirm in Monstera and retry `curl` above.
- **Network / could not reach** → rare; confirm `https://monsteracloud.com` is up; check corporate proxy.
- **Empty report** → seed metrics or widen the date range; demo data endpoint if you use it (`POST /api/settings/demo-metrics` in dev).

---

## 3) What to capture in the real recording (outline)

Keep it short (often **under ~3 minutes** unless Google specifies otherwise).

1. **Intro (10–15 s):** “This is the Monstera Cloud community connector for Looker Studio.”
2. **Auth (20–30 s):** Show pasting the workspace API key; successful connection.
3. **Config (15 s):** Platform filter (All vs one platform).
4. **Report (60–90 s):** Add dimensions/metrics, show a chart updating when you change the date range or platform.
5. **Outro (10 s):** Support URL `https://monsteracloud.com/support` and connector page `https://monsteracloud.com/looker-studio` (optional: show in browser).

Upload the MP4 to `public/showcase/` and reference `https://monsteracloud.com/showcase/your-file.mp4` in the submission form (see `SUBMISSION-CHECKLIST.md`).

---

## 4) Repo references

- Connector: `Code.js` — `APP_URL` + `/api/looker-studio`
- Manifest: `appsscript.json` — `dataStudio` block (name, support URL, logo)

After a successful mockup, you’re ready to record the same flow once, with a clean desktop and stable network.