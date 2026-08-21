/**
 * Monstera Cloud — Google Sheets™ Editor Add-on
 * Version: 3.1.0
 *
 * Auth   : Google identity token (ScriptApp.getIdentityToken)
 *          No API key required — user is identified by their Google account.
 * Backend: /api/looker-studio (shared with Looker Studio connector)
 *
 * Scopes (must match appsscript.json, Marketplace SDK, and OAuth consent screen):
 *   openid
 *   https://www.googleapis.com/auth/userinfo.email
 *   https://www.googleapis.com/auth/spreadsheets.currentonly
 *   https://www.googleapis.com/auth/script.external_request
 *   https://www.googleapis.com/auth/script.container.ui
 */

var BASE_URL         = 'https://monsteracloud.com';
var API_ENDPOINT     = BASE_URL + '/api/looker-studio';
var AUTH_ENDPOINT    = BASE_URL + '/api/addon/auth';
var ACCOUNTS_ENDPOINT = BASE_URL + '/api/addon/accounts';
var CACHE_TTL_SECONDS = 600;
var EMPTY_RESULT_MESSAGE = 'No rows found for the selected filters.';

// ── Platform-specific column sets ─────────────────────────────────────────────

var PLATFORM_FIELDS = {
  meta_ads: [
    'date', 'accountName', 'campaignName', 'adsetName',
    'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm',
    'conversions', 'revenue', 'roas', 'currency'
  ],
  google_ads: [
    'date', 'accountName', 'campaignName', 'adsetName',
    'spend', 'impressions', 'clicks', 'ctr', 'cpc',
    'conversions', 'revenue', 'roas', 'currency'
  ],
  tiktok_business: [
    'date', 'accountName', 'campaignName', 'adsetName',
    'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm',
    'conversions', 'revenue', 'roas', 'currency'
  ],
  shopee: [
    'date', 'accountName', 'campaignName',
    'spend', 'impressions', 'clicks', 'ctr', 'cpc',
    'conversions', 'revenue', 'roas', 'currency'
  ],
  lazada: [
    'date', 'accountName', 'campaignName',
    'spend', 'impressions', 'clicks',
    'conversions', 'revenue', 'roas', 'currency'
  ],
  all: [
    'date', 'platform', 'accountName', 'campaignName', 'adsetName',
    'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
    'conversions', 'revenue', 'roas', 'currency'
  ]
};

function getFieldOrder(platform) {
  return PLATFORM_FIELDS[platform] || PLATFORM_FIELDS['all'];
}

// ── Identity Token ────────────────────────────────────────────────────────────

function getIdentityToken() {
  try {
    return ScriptApp.getIdentityToken();
  } catch (e) {
    return null;
  }
}

/**
 * Verifies the user's Google identity against Monstera backend.
 * Returns { ok, user } on success or { ok, noAccount, error } on failure.
 */
function checkAuth() {
  var token = getIdentityToken();
  if (!token) return { ok: false, error: 'Could not get identity token. Try closing and reopening the sidebar.' };

  try {
    var response = UrlFetchApp.fetch(AUTH_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: token }),
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    var data = JSON.parse(response.getContentText());

    if (status === 200) return { ok: true, user: data };
    if (status === 404 && data.code === 'NO_ACCOUNT') return { ok: false, noAccount: true, error: data.error };
    return { ok: false, error: data.error || 'Authentication failed.' };
  } catch (e) {
    return { ok: false, error: 'Could not reach Monstera Cloud. Check your connection.' };
  }
}

/**
 * Returns ad accounts for the authenticated user, optionally filtered by platform.
 * Called from Sidebar when platform changes to populate the account selector.
 */
function getAccounts(platform, workspaceId) {
  var token = getIdentityToken();
  if (!token) return { ok: false, error: 'Could not authenticate.' };
  if (!workspaceId) return { ok: false, error: 'Select an agency workspace first.' };

  var url = ACCOUNTS_ENDPOINT + '?workspaceId=' + encodeURIComponent(workspaceId)
    + (platform ? '&platform=' + encodeURIComponent(platform) : '');
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    var data = JSON.parse(response.getContentText());
    if (status === 200) return { ok: true, accounts: data.accounts || [] };
    return { ok: false, error: data.error || 'Could not load accounts.' };
  } catch (e) {
    return { ok: false, error: 'Could not reach Monstera Cloud.' };
  }
}

// ── Workspace Add-on homepage (required by addOns manifest) ──────────────────

function onHomepage(e) {
  return CardService.newCardBuilder()
    .setName('Monstera Cloud')
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('<b>Monstera Cloud</b><br>Ad Data Connector for Google Sheets™')
        )
        .addWidget(
          CardService.newTextParagraph()
            .setText('Pull Meta Ads, Google Ads™, and TikTok Ads performance data directly into your spreadsheet.')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Open Data Connector')
            .setOnClickAction(
              CardService.newAction().setFunctionName('openSidebarFromCard')
            )
        )
    )
    .build();
}

function openSidebarFromCard() {
  showSidebar();
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Opening Monstera Cloud…'))
    .build();
}

// ── Menu & Sidebar ────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Monstera Cloud')
    .addItem('Open Data Connector', 'showSidebar')
    .addItem('Refresh Current Sheet', 'refreshCurrentSheet')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Monstera Cloud — Sheets Connector')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ── Data Pull ─────────────────────────────────────────────────────────────────

function pullData(params) {
  var token = getIdentityToken();
  if (!token) throw new Error('Could not authenticate. Please close and reopen the sidebar.');

  params = params || {};
  var startDate   = params.startDate   || getTodayMinus(30);
  var endDate     = params.endDate     || getToday();
  var platform    = params.platform    || null;
  var reportLevel = params.reportLevel || 'adset';
  var accountIds  = normalizeAccountIds(params.accountIds);
  var targetCell  = params.targetCell  || 'A1';
  var workspaceId = params.workspaceId || '';
  if (!workspaceId) throw new Error('Select an agency workspace first.');

  var qp = [
    'workspaceId=' + encodeURIComponent(workspaceId),
    'startDate='   + encodeURIComponent(startDate),
    'endDate='     + encodeURIComponent(endDate),
    'reportLevel=' + encodeURIComponent(reportLevel),
  ];
  if (platform) qp.push('platform=' + encodeURIComponent(platform));
  accountIds.forEach(function(id) { qp.push('accountId=' + encodeURIComponent(id)); });

  var url = API_ENDPOINT + '?' + qp.join('&');

  var cache = CacheService.getUserCache();
  var accountSelection = accountIds.length ? accountIds.join(',') : 'all';
  var cacheKey = 'sheets_' + workspaceId + '_' + startDate + '_' + endDate + '_' + (platform || 'all') + '_' + reportLevel + '_' + accountSelection;
  var responseData = null;
  var fromCache = false;

  logQueryDiagnostics('request', {
    workspaceId: workspaceId,
    platform: platform || 'all',
    reportLevel: reportLevel,
    startDate: startDate,
    endDate: endDate,
    accountIds: accountIds
  });

  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      responseData = JSON.parse(cached);
      fromCache = !!(responseData && Array.isArray(responseData.data) && responseData.data.length > 0);
      if (!fromCache) responseData = null;
    } catch(e) { responseData = null; }
  }

  if (!responseData) {
    var response = fetchWithRetry(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

    var status = response.getResponseCode();
    var body = response.getContentText();

    if (status === 401) throw new Error('Session expired. Please close and reopen the sidebar.');
    if (status === 404) throw new Error('No Monstera account found for your Google account. Sign up at monsteracloud.com');
    if (status !== 200) {
      var msg = 'Server returned ' + status;
      try { var parsed = JSON.parse(body); if (parsed.error) msg = parsed.error; } catch(e) {}
      throw new Error('Data pull failed: ' + msg);
    }

    try { responseData = JSON.parse(body); } catch(e) {
      throw new Error('Unexpected response from Monstera Cloud.');
    }

    if (Array.isArray(responseData.data) && responseData.data.length > 0) {
      try { cache.put(cacheKey, body, CACHE_TTL_SECONDS); } catch(e) {}
    }
  }

  if (!responseData.data || !Array.isArray(responseData.data)) {
    logQueryDiagnostics('response', {
      workspaceId: workspaceId,
      platform: platform || 'all',
      reportLevel: reportLevel,
      startDate: startDate,
      endDate: endDate,
      accountIds: accountIds,
      returnedRowCount: 0,
      fromCache: fromCache
    });
    return EMPTY_RESULT_MESSAGE;
  }

  var data = responseData.data;
  logQueryDiagnostics('response', {
    workspaceId: workspaceId,
    platform: platform || 'all',
    reportLevel: reportLevel,
    startDate: startDate,
    endDate: endDate,
    accountIds: accountIds,
    returnedRowCount: data.length,
    fromCache: fromCache
  });
  if (data.length === 0) return EMPTY_RESULT_MESSAGE;

  var headers = getFieldOrder(platform).filter(function(f) { return data[0].hasOwnProperty(f); });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var startRow = sheet.getRange(targetCell).getRow();
  var startCol = sheet.getRange(targetCell).getColumn();

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow >= startRow && lastCol >= startCol) {
    sheet.getRange(
      startRow, startCol,
      Math.max(lastRow - startRow + 1, 1),
      Math.max(lastCol - startCol + 1, headers.length)
    ).clearContent();
  }

  var headerRange = sheet.getRange(startRow, startCol, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f3f4f6');

  var rows = data.map(function(item) {
    return headers.map(function(h) { return (item[h] == null) ? '' : item[h]; });
  });
  sheet.getRange(startRow + 1, startCol, rows.length, headers.length).setValues(rows);

  for (var i = 0; i < headers.length; i++) { sheet.autoResizeColumn(startCol + i); }

  PropertiesService.getDocumentProperties().setProperty(
    'monstera_query_' + sheet.getSheetId(),
    JSON.stringify({ workspaceId: workspaceId, platform: platform, reportLevel: reportLevel, accountIds: accountIds, targetCell: targetCell })
  );

  return 'Done! ' + data.length + ' rows written to ' + sheet.getName() + '.';
}

// ── Refresh ───────────────────────────────────────────────────────────────────

function refreshCurrentSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var saved = PropertiesService.getDocumentProperties()
    .getProperty('monstera_query_' + sheet.getSheetId());

  if (!saved) {
    SpreadsheetApp.getUi().alert('No saved query for this sheet. Open the sidebar and run a query first.');
    return;
  }

  var params = JSON.parse(saved);
  params.startDate = getTodayMinus(30);
  params.endDate   = getToday();

  try {
    var result = pullData(params);
    SpreadsheetApp.getUi().alert('Refreshed! ' + result);
  } catch(e) {
    SpreadsheetApp.getUi().alert('Refresh failed: ' + e.message);
  }
}

function refreshAllSheets() {
  var token = getIdentityToken();
  if (!token) return;

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();
  var sheets = spreadsheet.getSheets();

  sheets.forEach(function(sheet) {
    var key = 'monstera_query_' + sheet.getSheetId();
    var saved = props.getProperty(key);
    if (!saved) return;
    try {
      var params = JSON.parse(saved);
      params.startDate = getTodayMinus(30);
      params.endDate   = getToday();
      pullDataToSheet(sheet, params, token);
    } catch(e) {
      console.error('[Monstera] Auto-refresh failed for sheet ' + sheet.getName() + ': ' + e.message);
    }
  });
}

function pullDataToSheet(sheet, params, token) {
  var startDate   = params.startDate   || getTodayMinus(30);
  var endDate     = params.endDate     || getToday();
  var platform    = params.platform    || null;
  var reportLevel = params.reportLevel || 'adset';
  var accountIds  = normalizeAccountIds(params.accountIds);
  var targetCell  = params.targetCell  || 'A1';
  var workspaceId = params.workspaceId || '';
  if (!workspaceId) return;

  var qp = [
    'workspaceId=' + encodeURIComponent(workspaceId),
    'startDate='   + encodeURIComponent(startDate),
    'endDate='     + encodeURIComponent(endDate),
    'reportLevel=' + encodeURIComponent(reportLevel),
  ];
  if (platform) qp.push('platform=' + encodeURIComponent(platform));
  accountIds.forEach(function(id) { qp.push('accountId=' + encodeURIComponent(id)); });

  var url = API_ENDPOINT + '?' + qp.join('&');
  var response = fetchWithRetry(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) return;

  var responseData;
  try { responseData = JSON.parse(response.getContentText()); } catch(e) { return; }
  if (!responseData.data || responseData.data.length === 0) return;

  var data = responseData.data;
  var headers = getFieldOrder(params.platform).filter(function(f) { return data[0].hasOwnProperty(f); });

  var startRow = sheet.getRange(targetCell).getRow();
  var startCol = sheet.getRange(targetCell).getColumn();

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow >= startRow && lastCol >= startCol) {
    sheet.getRange(
      startRow, startCol,
      Math.max(lastRow - startRow + 1, 1),
      Math.max(lastCol - startCol + 1, headers.length)
    ).clearContent();
  }

  var headerRange = sheet.getRange(startRow, startCol, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f3f4f6');

  var rows = data.map(function(item) {
    return headers.map(function(h) { return (item[h] == null) ? '' : item[h]; });
  });
  sheet.getRange(startRow + 1, startCol, rows.length, headers.length).setValues(rows);
  for (var i = 0; i < headers.length; i++) { sheet.autoResizeColumn(startCol + i); }
}

function normalizeAccountIds(accountIds) {
  if (!Array.isArray(accountIds)) return [];
  // Preserve the user's selection order (the server orders rows by this
  // sequence); dedupe only. Do NOT sort alphabetically here.
  var seen = {};
  return accountIds.slice()
    .map(function(id) { return String(id).trim(); })
    .filter(function(id) {
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
}

function logQueryDiagnostics(eventName, details) {
  // Deliberately limited to filter metadata and row counts; never log tokens,
  // cookies, OAuth credentials, or response bodies.
  console.log('[Monstera Sheets] ' + eventName + ' ' + JSON.stringify(details));
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getToday() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getTodayMinus(days) {
  var d = new Date();
  d.setDate(d.getDate() - days);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function fetchWithRetry(url, options, retryCount) {
  retryCount = retryCount || 0;
  var MAX_RETRIES = 3;
  var RETRY_DELAY_MS = 1000;
  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch(e) {
    if (retryCount < MAX_RETRIES) {
      Utilities.sleep(RETRY_DELAY_MS * Math.pow(2, retryCount));
      return fetchWithRetry(url, options, retryCount + 1);
    }
    throw e;
  }
  var status = response.getResponseCode();
  if ((status >= 500 || status === 0) && retryCount < MAX_RETRIES) {
    Utilities.sleep(RETRY_DELAY_MS * Math.pow(2, retryCount));
    return fetchWithRetry(url, options, retryCount + 1);
  }
  return response;
}
