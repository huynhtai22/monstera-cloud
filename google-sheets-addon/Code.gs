/**
 * Monstera Cloud — Google Sheets Add-on
 * Server-side Apps Script (Code.gs)
 *
 * Uses ScriptApp.getOAuthToken() to authenticate with Monstera Cloud API.
 * No API key, no separate login — uses the user's existing Google identity.
 */

var API_BASE = 'https://monsteracloud.com/api/v1/sheets';

// ── Menu & Sidebar ──────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Monstera Cloud')
    .addItem('Open Data Connector', 'showSidebar')
    .addItem('Refresh Current Query', 'refreshCurrentQuery')
    .addToUi();
}

function onInstall(e) {
  onOpen();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Monstera Cloud')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function authenticateUser() {
  var token = ScriptApp.getOAuthToken();
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ googleToken: token }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(API_BASE + '/auth', options);
  return JSON.parse(response.getContentText());
}

// ── Connections ──────────────────────────────────────────────────────────────

function getConnections() {
  var token = ScriptApp.getOAuthToken();
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ googleToken: token }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(API_BASE + '/connections', options);
  return JSON.parse(response.getContentText());
}

// ── Schema ───────────────────────────────────────────────────────────────────

function getSchema() {
  var response = UrlFetchApp.fetch(API_BASE + '/schema', { muteHttpExceptions: true });
  return JSON.parse(response.getContentText());
}

// ── Query ────────────────────────────────────────────────────────────────────

function runQuery(params) {
  var token = ScriptApp.getOAuthToken();
  params.googleToken = token;

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(params),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(API_BASE + '/query', options);
  var result = JSON.parse(response.getContentText());

  if (result.error) {
    return result;
  }

  // Write data to the active sheet
  var sheet = SpreadsheetApp.getActiveSheet();
  var targetCell = params.targetCell || 'A1';

  // Clear existing data in the target area
  var startRow = sheet.getRange(targetCell).getRow();
  var startCol = sheet.getRange(targetCell).getColumn();

  if (result.headers && result.headers.length > 0) {
    // Clear old data
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow > 0 && lastCol > 0) {
      sheet.getRange(startRow, startCol, Math.max(lastRow - startRow + 1, 1), Math.max(lastCol - startCol + 1, result.headers.length))
        .clearContent();
    }

    // Write headers (bold)
    var headerRange = sheet.getRange(startRow, startCol, 1, result.headers.length);
    headerRange.setValues([result.headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f3f4f6');

    // Write data rows
    if (result.rows.length > 0) {
      var dataRange = sheet.getRange(startRow + 1, startCol, result.rows.length, result.headers.length);
      dataRange.setValues(result.rows);
    }

    // Auto-resize columns
    for (var i = 0; i < result.headers.length; i++) {
      sheet.autoResizeColumn(startCol + i);
    }
  }

  // Save query config as sheet property for refresh
  var props = PropertiesService.getDocumentProperties();
  props.setProperty('monstera_query_' + sheet.getName(), JSON.stringify({
    source: params.source,
    connectionId: params.connectionId,
    advertiser_id: params.advertiser_id,
    data_level: params.data_level,
    dimensions: params.dimensions,
    metrics: params.metrics,
    start_date: params.start_date,
    end_date: params.end_date,
    targetCell: targetCell
  }));

  return {
    success: true,
    rowCount: result.rows.length,
    truncated: result.truncated || false,
    totalRows: result.totalRows || result.rows.length
  };
}

// ── Refresh ──────────────────────────────────────────────────────────────────

function refreshCurrentQuery() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var props = PropertiesService.getDocumentProperties();
  var saved = props.getProperty('monstera_query_' + sheet.getName());

  if (!saved) {
    SpreadsheetApp.getUi().alert('No saved query found for this sheet. Run a query first using the sidebar.');
    return;
  }

  var params = JSON.parse(saved);
  var result = runQuery(params);

  if (result.error) {
    SpreadsheetApp.getUi().alert('Refresh failed: ' + (result.message || result.error));
  } else {
    SpreadsheetApp.getUi().alert('Refreshed! ' + result.rowCount + ' rows updated.');
  }
}

// ── Scheduled Refresh (time-based trigger) ───────────────────────────────────

function setupRefreshTrigger(intervalHours) {
  // Remove existing triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'refreshAllSheets') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  if (intervalHours > 0) {
    ScriptApp.newTrigger('refreshAllSheets')
      .timeBased()
      .everyHours(intervalHours)
      .create();
  }

  return { success: true, intervalHours: intervalHours };
}

function refreshAllSheets() {
  var props = PropertiesService.getDocumentProperties();
  var all = props.getProperties();
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();

  for (var i = 0; i < sheets.length; i++) {
    var key = 'monstera_query_' + sheets[i].getName();
    if (all[key]) {
      SpreadsheetApp.setActiveSheet(sheets[i]);
      var params = JSON.parse(all[key]);
      // Update date range to today
      var today = new Date();
      params.end_date = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      runQuery(params);
    }
  }
}
