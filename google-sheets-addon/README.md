# Monstera Cloud — Google Sheets Add-on

## Setup (Development / Testing)

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Copy `Code.gs` content into the default Code.gs file
3. Create a new HTML file called `Sidebar` and paste `Sidebar.html` content
4. Copy `appsscript.json` content: View → Show manifest file → paste
5. Update `API_BASE` in Code.gs if your Vercel URL is different
6. Click **Deploy → Test deployments → Install** to test in a Google Sheet

## How it works

1. User opens the sidebar from the **Monstera Cloud** menu
2. Add-on calls `ScriptApp.getOAuthToken()` — gets the user's Google identity automatically
3. Sends token to our API which verifies it and checks subscription
4. Free users see an upgrade prompt; paid users see the full query builder
5. User picks connection, dimensions, metrics, date range
6. Clicks "Get Data" → API fetches from TikTok → rows written to sheet
7. Query config saved to sheet properties for one-click refresh
8. Optional: set auto-refresh schedule (1h, 3h, 6h, 12h, daily)

## Publishing (Google Workspace Marketplace)

Follow **[MARKETPLACE-CHECKLIST.md](./MARKETPLACE-CHECKLIST.md)** end-to-end: trademark attribution in the Marketplace SDK listing, identical OAuth scopes in Apps Script / GCP consent screen / Marketplace SDK, Google Sheets API enabled on the linked project, OAuth verification **before** resubmitting Marketplace, and no public install links to an unpublished listing.

High level:

1. Deploy → New deployment → Add-on (create a new deployment version after any `appsscript.json` change).
2. Complete the Marketplace SDK listing using the checklist (including **Google Sheets™** / **Google Workspace™** where appropriate and the trademark footnote in the long description).
3. After OAuth verification is approved for the same Cloud project, submit the listing for Marketplace review (typically several business days).

Do **not** add clickable Google Workspace Marketplace or Chrome Web Store install URLs to your marketing site, privacy policy domain pages, or OAuth-linked README until the listing is approved.