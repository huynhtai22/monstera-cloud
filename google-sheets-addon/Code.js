/**
 * Monstera Cloud — Google Sheets™ Editor Add-on
 * Version: 2.0.0
 *
 * Auth   : Monstera workspace API key (same model as the Looker Studio connector)
 * Backend: /api/looker-studio — the same endpoint the Looker Studio connector uses.
 *
 * Scopes (must match appsscript.json, Marketplace SDK, and OAuth consent screen):
 *   https://www.googleapis.com/auth/spreadsheets.currentonly
 *   https://www.googleapis.com/auth/script.external_request
 *   https://www.googleapis.com/auth/script.container.ui
 *   https://www.googleapis.com/auth/script.scriptapp
 *   https://www.googleapis.com/auth/userinfo.email
 */

var BASE_URL = 'https://monsteracloud.com';
var API_ENDPOINT = BASE_URL + '/api/looker-studio';
var API_KEY_PROP = 'MONSTERA_API_KEY';
var CACHE_TTL_SECONDS = 600; // 10 minutes — same as Looker Studio connector default

// ── Menu & Sidebar ────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Monstera Cloud')
    .addItem('Open Data Connector', 'showSidebar')
    .addItem('Refresh Current Sheet', 'refreshCurrentSheet')
    .addSeparator()
    .addItem('Clear API Key', 'clearApiKey')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Monstera Cloud')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ── API Key Auth ──────────────────────────────────────────────────────────────

function saveApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('API key cannot be empty.');
  }
  // Validate the key against the API before saving
  var code = pingWithKey(apiKey.trim());
  if (code === 401) throw new Error('Invalid API key — rejected by Monstera Cloud.');
  if (code !== 200) throw new Error('Could not reach Monstera Cloud (status ' + code + '). Check your connection.');
  PropertiesService.getUserProperties().setProperty(API_KEY_PROP, apiKey.trim());
  return 'API key saved and verified.';
}

function getApiKey() {
  return PropertiesService.getUserProperties().getProperty(API_KEY_PROP) || '';
}

function clearApiKey() {
  PropertiesService.getUserProperties().deleteProperty(API_KEY_PROP);
  // Also clear any saved sheet queries
  var props = PropertiesService.getDocumentProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf('monstera_query_') === 0) props.deleteProperty(key);
  });
  return 'API key and saved queries cleared.';
}

/** Lightweight ping — same pattern as Looker Studio connector's isAuthValid(). */
function pingWithKey(key) {
  try {
    var response = UrlFetchApp.fetch(API_ENDPOINT + '?ping=1', {
      headers: { Authorization: 'Bearer ' + key },
      muteHttpExceptions: true
    });
    return response.getResponseCode();
  } catch (e) {
    return 0;
  }
}

function isAuthenticated() {
  var key = getApiKey();
  if (!key) return false;
  return pingWithKey(key) === 200;
}

// ── Data Pull ─────────────────────────────────────────────────────────────────

/**
 * Called from Sidebar. Fetches data from /api/looker-studio and writes to sheet.
 *
 * @param {Object} params
 *   platform      {string}  'tiktok_business' | 'meta_ads' | 'google_ads' | null (all)
 *   startDate     {string}  'YYYY-MM-DD'
 *   endDate       {string}  'YYYY-MM-DD'
 *   reportLevel   {string}  'adset' | 'campaign' | 'account'
 *   accountIds    {Array}   optional list of account IDs to filter
 *   targetCell    {string}  e.g. 'A1' — where to start writing (default 'A1')
 */
function pullData(params) {
  var apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key found. Enter your Monstera API key in the sidebar.');

  params = params || {};
  var startDate  = params.startDate  || getTodayMinus(30);
  var endDate    = params.endDate    || getToday();
  var platform   = params.platform   || null;
  var reportLevel = params.reportLevel || 'adset';
  var accountIds = params.accountIds  || [];
  var targetCell = params.targetCell  || 'A1';

  // Build query string — same parameter names as the Looker Studio connector
  var qp = [
    'startDate=' + encodeURIComponent(startDate),
    'endDate='   + encodeURIComponent(endDate),
    'reportLevel=' + encodeURIComponent(reportLevel),
  ];
  if (platform) qp.push('platform=' + encodeURIComponent(platform));
  if (accountIds.length > 0) {
    accountIds.forEach(function(id) {
      qp.push('accountId=' + encodeURIComponent(id));
    });
  }

  var url = API_ENDPOINT + '?' + qp.join('&');

  // Check cache first (same CacheService pattern as Looker Studio connector)
  var cache = CacheService.getUserCache();
  var cacheKey = 'sheets_' + startDate + '_' + endDate + '_' + (platform || 'all') + '_' + reportLevel;
  var responseData = null;

  var cached = cache.get(cacheKey);
  if (cached) {
    try { responseData = JSON.parse(cached); } catch(e) { responseData = null; }
  }

  if (!responseData) {
    var response = fetchWithRetry(url, {
      headers: { Authorization: 'Bearer ' + apiKey },
      muteHttpExceptions: true
    });

    var status = response.getResponseCode();
    var body = response.getContentText();

    if (status === 401) throw new Error('API key rejected. Re-enter your key in the sidebar.');
    if (status !== 200) {
      var msg = 'Server returned ' + status;
      try { var parsed = JSON.parse(body); if (parsed.error) msg = parsed.error; } catch(e) {}
      throw new Error('Data pull failed: ' + msg);
    }

    try {
      responseData = JSON.parse(body);
    } catch(e) {
      throw new Error('Monstera Cloud returned an unexpected response format.');
    }

    try { cache.put(cacheKey, body, CACHE_TTL_SECONDS); } catch(e) { /* too large to cache */ }
  }

  if (!responseData.data || !Array.isArray(responseData.data)) {
    return 'No data returned for the selected filters. Try a wider date range.';
  }

  var data = responseData.data;
  if (data.length === 0) {
    return 'No rows found for the selected filters.';
  }

  // Build headers from first row keys — consistent field order
  var FIELD_ORDER = [
    'date', 'platform', 'accountId', 'accountName',
    'campaignId', 'campaignName', 'adsetId', 'adsetName', 'currency',
    'impressions', 'clicks', 'spend', 'reach', 'conversions', 'revenue'
  ];
  var headers = FIELD_ORDER.filter(function(f) {
    return data[0].hasOwnProperty(f);
  });

  // Write to sheet
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var startRow = sheet.getRange(targetCell).getRow();
  var startCol = sheet.getRange(targetCell).getColumn();

  // Clear existing content in the target area
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow >= startRow && lastCol >= startCol) {
    sheet.getRange(startRow, startCol, Math.max(lastRow - startRow + 1, 1), Math.max(lastCol - startCol + 1, headers.length))
      .clearContent();
  }

  // Write headers (bold + light background)
  var headerRange = sheet.getRange(startRow, startCol, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f3f4f6');

  // Write data rows
  if (data.length > 0) {
    var rows = data.map(function(item) {
      return headers.map(function(h) {
        var val = item[h];
        return (val == null) ? '' : val;
      });
    });
    sheet.getRange(startRow + 1, startCol, rows.length, headers.length).setValues(rows);
  }

  // Auto-resize columns
  for (var i = 0; i < headers.length; i++) {
    sheet.autoResizeColumn(startCol + i);
  }

  // Save query config for refresh
  PropertiesService.getDocumentProperties().setProperty(
    'monstera_query_' + sheet.getSheetId(),
    JSON.stringify({
      platform: platform,
      reportLevel: reportLevel,
      accountIds: accountIds,
      targetCell: targetCell
      // Note: dates are intentionally NOT saved — refresh always uses a rolling window
    })
  );

  return 'Done! ' + data.length + ' rows written to ' + sheet.getName() + '.';
}

// ── Refresh ───────────────────────────────────────────────────────────────────

/**
 * Refreshes the active sheet's saved query with a rolling 30-day window.
 * Called from the menu. Shows a UI alert with the result.
 */
function refreshCurrentSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var saved = PropertiesService.getDocumentProperties()
    .getProperty('monstera_query_' + sheet.getSheetId());

  if (!saved) {
    SpreadsheetApp.getUi().alert(
      'No saved query for this sheet. Open the sidebar and run a query first.'
    );
    return;
  }

  var params = JSON.parse(saved);
  // Rolling window: always refresh to today
  params.startDate = getTodayMinus(30);
  params.endDate   = getToday();

  try {
    var result = pullData(params);
    SpreadsheetApp.getUi().alert('Refreshed! ' + result);
  } catch(e) {
    SpreadsheetApp.getUi().alert('Refresh failed: ' + e.message);
  }
}

/**
 * Time-based trigger handler — refreshes ALL sheets with saved queries.
 * Uses sheet ID (not name) as key so renames don't break saved queries.
 * IMPORTANT: Does NOT call setActiveSheet() — that fails in trigger context.
 */
function refreshAllSheets() {
  var apiKey = getApiKey();
  if (!apiKey) return; // No key — nothing to do

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

      // In trigger context, we write directly to the sheet by reference
      // (not via getActiveSheet which requires UI context)
      pullDataToSheet(sheet, params, apiKey);
    } catch(e) {
      console.error('[Monstera] Auto-refresh failed for sheet ' + sheet.getName() + ': ' + e.message);
    }
  });
}

/**
 * Writes data to a specific sheet reference — safe for use in time-based triggers.
 * Mirrors pullData() but accepts a sheet object directly instead of using getActiveSheet().
 */
function pullDataToSheet(sheet, params, apiKey) {
  var startDate   = params.startDate   || getTodayMinus(30);
  var endDate     = params.endDate     || getToday();
  var platform    = params.platform    || null;
  var reportLevel = params.reportLevel || 'adset';
  var accountIds  = params.accountIds  || [];
  var targetCell  = params.targetCell  || 'A1';

  var qp = [
    'startDate='   + encodeURIComponent(startDate),
    'endDate='     + encodeURIComponent(endDate),
    'reportLevel=' + encodeURIComponent(reportLevel),
  ];
  if (platform) qp.push('platform=' + encodeURIComponent(platform));
  accountIds.forEach(function(id) { qp.push('accountId=' + encodeURIComponent(id)); });

  var url = API_ENDPOINT + '?' + qp.join('&');
  var response = fetchWithRetry(url, {
    headers: { Authorization: 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) return; // Silent fail in trigger

  var responseData;
  try { responseData = JSON.parse(response.getContentText()); } catch(e) { return; }
  if (!responseData.data || responseData.data.length === 0) return;

  var data = responseData.data;
  var FIELD_ORDER = [
    'date', 'platform', 'accountId', 'accountName',
    'campaignId', 'campaignName', 'adsetId', 'adsetName', 'currency',
    'impressions', 'clicks', 'spend', 'reach', 'conversions', 'revenue'
  ];
  var headers = FIELD_ORDER.filter(function(f) { return data[0].hasOwnProperty(f); });

  var startRow = sheet.getRange(targetCell).getRow();
  var startCol = sheet.getRange(targetCell).getColumn();

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow >= startRow && lastCol >= startCol) {
    sheet.getRange(startRow, startCol, Math.max(lastRow - startRow + 1, 1), Math.max(lastCol - startCol + 1, headers.length))
      .clearContent();
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

/**
 * Creates or replaces a time-based auto-refresh trigger.
 * Called from Sidebar when user sets up a schedule.
 */
function setupRefreshTrigger(intervalHours) {
  // Remove all existing Monstera refresh triggers
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'refreshAllSheets') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  if (intervalHours > 0) {
    ScriptApp.newTrigger('refreshAllSheets')
      .timeBased()
      .everyHours(intervalHours)
      .create();
    return { success: true, message: 'Auto-refresh set to every ' + intervalHours + ' hour(s).' };
  }

  return { success: true, message: 'Auto-refresh disabled.' };
}

function getRefreshSchedule() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'refreshAllSheets') {
      return { active: true };
    }
  }
  return { active: false };
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

/**
 * Fetch with exponential backoff retry for 5xx / network errors.
 * Same pattern as Looker Studio connector's fetchWithRetry().
 */
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
