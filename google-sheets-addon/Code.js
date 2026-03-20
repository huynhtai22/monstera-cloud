/**
 * Monstera Cloud - Google Sheets Editor Add-on
 * 
 * Runs entirely on Google's V8 Engine sandbox.
 */

const BASE_URL = 'https://monsteracloud.com';

/**
 * Triggered automatically when the spreadsheet is opened.
 * Adds the Monstera Cloud custom menu to the toolbar.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🌱 Monstera Cloud')
    .addItem('Launch Connector', 'showSidebar')
    .addToUi();
}

/**
 * Opens the HTML sidebar in the Google Sheets UI.
 */
function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Monstera Cloud')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Securely saves the Monstera Cloud API Key in the user's properties.
 * PropertiesService is a native, encrypted App Script Key-Value store.
 */
function saveApiKey(apiKey) {
  PropertiesService.getUserProperties().setProperty('MONSTERA_API_KEY', apiKey);
  return 'Key saved successfully.';
}

/**
 * Retrieves the currently saved API Key. Used by the Sidebar to persist state.
 */
function getApiKey() {
  return PropertiesService.getUserProperties().getProperty('MONSTERA_API_KEY') || '';
}

/**
 * Clears the saved API Key, effectively logging the user out.
 */
function clearApiKey() {
  PropertiesService.getUserProperties().deleteProperty('MONSTERA_API_KEY');
  return 'Key cleared.';
}

/**
 * Pulls live data from Monstera Cloud and writes it directly to the active sheet.
 * Uses UrlFetchApp to perform HTTP requests from Google's servers.
 */
function pullDataFromMonstera() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No API Key found. Please save your API Key first.');
  }

  // Use the API export endpoint
  const url = `${BASE_URL}/api/export/rows`;
  
  const options = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    },
    muteHttpExceptions: true // We manually handle errors rather than throwing immediately
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  
  if (responseCode !== 200) {
    const errorBody = response.getContentText();
    let errorMsg = `Server returned ${responseCode}`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error) errorMsg = parsed.error;
    } catch(e) {}
    throw new Error(`Data Pull Failed: ${errorMsg}`);
  }

  const json = JSON.parse(response.getContentText());
  const rows = json.rows || [];

  if (rows.length === 0) {
    return 'Success! No data to sync currently.';
  }

  // Write Data to Sheet
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.clearContents(); // Clear old data

  // Write the 2D array matrix back to the spreadsheet efficiently
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Auto-resize columns for a polished look
  sheet.autoResizeColumns(1, rows[0].length);

  // Return success message back to the Sidebar
  return `Successfully pulled ${rows.length - 1} records!`;
}
