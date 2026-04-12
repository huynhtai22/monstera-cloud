# Looker Studio Partner Connector — submission checklist

Use this wih [PSCC requirements](https://developers.google.com/looker-studio/connector/pscc-requirements) and [manifest reference](https://developers.google.com/looker-studio/connector/manifest).

## Code & API (repo)

- `**/api/looker-studio**` — smoke-test with a real workspace API key:
  - Ping (no DB metrics query):  
  `curl -sS -H "Authorization: Bearer YOUR_KEY" "https://monsteracloud.com/api/looker-studio?ping=1"` → `{"ok":true}`
  - Data (date range):  
  `curl -sS -H "Authorization: Bearer YOUR_KEY" "https://monsteracloud.com/api/looker-studio?startDate=2026-01-01&endDate=2026-01-31"` → `{ "data": [...] }`
- **Apps Script** — copy `Code.js` + `appsscript.json` into the Apps Script project, then **Deploy** a new version.

## Apps Script project (Google)

- Project **Settings** → enable **Show `appsscript.json` manifest file in editor**.
- **Share** view access with:
  - `data-studio-contrib-qa@googlegroups.com`
  - `data-studio-contrib@google.com`
- Create a deployment named `**Production`** on the version you want reviewed.
- **OAuth client verification** (required for all connectors, including KEY auth): follow [OAuth Client Verification](https://developers.google.com/apps-script/guides/client-verification). Confirm a **fresh Google account** authorizing the script does **not** hit the “Unverified app” blocking screen. Add required scopes on the OAuth consent screen (e.g. external HTTPS access scope used by the connector).

## Default report template (manifest)

Google expects a **default report template** when the connector uses a **fixed schema** — see [Providing report templates](https://developers.google.com/looker-studio/connector/report-templates).

1. In Looker Studio, build a **starter report** using your connector (simple time series + table is enough).
2. **File → Share → Get report link** (link sharing enabled).
3. From the report URL, copy the **report ID** (the long id in the URL path).
4. In `appsscript.json`, under `dataStudio`, add:

```json
"templates": {
  "default": "YOUR_REPORT_ID_HERE"
}
```

1. Deploy a new Apps Script version and point **Production** at it.

*(Until you have a real ID, omit `templates` so you do not ship a broken manifest.)*

## OAuth verification — how to confirm

1. Open the connector in Looker Studio with a **test Google user** that has never authorized the script.
2. Complete any Apps Script authorization prompts.
3. You should **not** be stuck on Google’s **“This app isn’t verified”** interstitial for normal use. If you are, finish verification or submit for verification in Google Cloud Console for the project bound to the script.

## Partner review request

- Requirements above satisfied.
- [Looker Studio Galleries Terms of Service (Submitter)](https://support.google.com/looker-studio/answer/7539411?ref_topic=7156687) accepted when submitting.
- Submit via **Publish your Partner Connector** on the [PSCC requirements](https://developers.google.com/looker-studio/connector/pscc-requirements) page.

## Loom / demo (your step)

- Record: add data source → paste API key → platform filter → date range → chart populates (or empty state explained).

