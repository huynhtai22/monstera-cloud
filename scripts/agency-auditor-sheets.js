const axios = require('axios');
const { google } = require('googleapis');

/**
 * Agency Auditor: Writes leads directly to a Google Sheet.
 * Requires: 
 * 1. A Google Service Account (or OAuth flow) authorized to edit Sheets.
 * 2. GOOGLE_APPLICATION_CREDENTIALS set in your VPS environment.
 */

async function writeToSheets(leads) {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = 'YOUR_SPREADSHEET_ID_HERE'; // Add your Sheet ID

  const values = leads.map(l => [l.name, l.email, l.website, l.scale]);
  
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Agency Auditor_Monstera Cloud!A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [['Company Name', 'Email', 'Website', 'Scale'], ...values] },
  });
  
  console.log("Successfully wrote leads to Google Sheets.");
}

async function runAgencyAuditor() {
    console.log("Auditing agencies...");
    // ... logic from before ...
    const leads = [
        { name: "Global Marketing VN", email: "hello@global.vn", website: "https://global.vn", scale: "Mid-Market" },
        { name: "Digital Growth APAC", email: "info@growth.vn", website: "https://growth.vn", scale: "Mid-Market" }
    ];
    
    await writeToSheets(leads);
}

runAgencyAuditor();
