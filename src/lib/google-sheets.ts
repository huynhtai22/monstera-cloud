/**
 * Google Sheets API client — uses stored OAuth tokens from the Account table (provider `google`).
 * Console “Sign in with Google” no longer requests Sheets/Drive scopes (GCP A vs add-ons split).
 * Tokens with Sheets scope must come from a dedicated Sheets-connect flow or legacy rows until migrated.
 */

import prisma from '@/lib/prisma';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

// ── Token helpers ────────────────────────────────────────────────────────────

interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

export async function getGoogleTokens(userId: string, explicitCreds?: any): Promise<GoogleTokens | null> {
  if (explicitCreds?.refreshToken || explicitCreds?.refresh_token) {
    return {
      accessToken: explicitCreds.accessToken || explicitCreds.access_token || '',
      refreshToken: explicitCreds.refreshToken || explicitCreds.refresh_token,
      expiresAt: explicitCreds.expiresAt || explicitCreds.expires_at || null,
    };
  }

  if (!userId) return null;

  const account = await (prisma.account as any).findFirst({
    where: { userId, provider: 'google' },
  });
  if (!account?.access_token) return null;
  return {
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    expiresAt: account.expires_at,
  };
}

async function refreshIfNeeded(userId: string, explicitCreds?: any): Promise<string> {
  const tokens = await getGoogleTokens(userId, explicitCreds);
  if (!tokens) throw new Error('No Google account or refresh token linked — please connect Google Sheets.');

  const now = Math.floor(Date.now() / 1000);
  if (tokens.accessToken && tokens.expiresAt && tokens.expiresAt > now + 60) {
    return tokens.accessToken;
  }

  // Token expired — refresh it
  if (!tokens.refreshToken) {
    throw new Error('Google token expired and no refresh token available. Please re-authorize Google Sheets.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  }

  // Persist the new access token if user account exists
  if (userId) {
    try {
      await (prisma.account as any).updateMany({
        where: { userId, provider: 'google' },
        data: {
          access_token: data.access_token,
          expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        },
      });
    } catch {}
  }

  return data.access_token as string;
}

// ── Sheets operations ────────────────────────────────────────────────────────

export interface SheetInfo {
  spreadsheetId: string;
  title: string;
  url: string;
}

/** Create a new spreadsheet and return its info. */
export async function createSpreadsheet(
  userId: string,
  title: string,
  explicitCreds?: any,
): Promise<SheetInfo> {
  const token = await refreshIfNeeded(userId, explicitCreds);

  const res = await fetch(SHEETS_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
    }),
  });

  const data = await res.json();
  if (!data.spreadsheetId) {
    throw new Error(`Failed to create spreadsheet: ${data.error?.message || JSON.stringify(data)}`);
  }

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties.title,
    url: data.spreadsheetUrl,
  };
}

/**
 * Copy an existing spreadsheet (template) into the user's Drive.
 * This is the recommended way to preserve charts, formulas, and named ranges.
 */
export async function copySpreadsheet(
  userId: string,
  templateSpreadsheetId: string,
  title: string,
  explicitCreds?: any,
): Promise<SheetInfo> {
  const token = await refreshIfNeeded(userId, explicitCreds);

  const res = await fetch(`${DRIVE_BASE}/files/${templateSpreadsheetId}/copy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: title,
    }),
  });

  const data = await res.json();
  if (!data?.id) {
    throw new Error(`Failed to copy spreadsheet: ${data.error?.message || JSON.stringify(data)}`);
  }

  // Fetch webViewLink for convenience
  const getUrl = new URL(`${DRIVE_BASE}/files/${data.id}`);
  getUrl.searchParams.set('fields', 'id,name,webViewLink');
  const res2 = await fetch(getUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const info = await res2.json();

  return {
    spreadsheetId: info.id,
    title: info.name,
    url: info.webViewLink,
  };
}

/** List spreadsheets the user owns or has edit access to. */
export async function listSpreadsheets(userId: string, explicitCreds?: any): Promise<SheetInfo[]> {
  const token = await refreshIfNeeded(userId, explicitCreds);

  const url = new URL(`${DRIVE_BASE}/files`);
  url.searchParams.set('q', "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  url.searchParams.set('fields', 'files(id,name,webViewLink)');
  url.searchParams.set('pageSize', '50');
  url.searchParams.set('orderBy', 'modifiedTime desc');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  return ((data.files as any[]) || []).map((f) => ({
    spreadsheetId: f.id,
    title: f.name,
    url: f.webViewLink,
  }));
}

/**
 * Write rows to a sheet tab. Clears existing data first (full replace).
 * columns: header names
 * rows: 2D array matching columns
 */
export async function writeToSheet(
  userId: string,
  spreadsheetId: string,
  sheetName: string,
  columns: string[],
  rows: (string | number)[][],
  explicitCreds?: any,
): Promise<{ updatedRows: number }> {
  const token = await refreshIfNeeded(userId, explicitCreds);

  // Clear sheet first
  await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  // Write header + data
  const values = [columns, ...rows];
  const range = `${sheetName}!A1`;

  const res = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    },
  );

  const data = await res.json();
  if (data.error) {
    throw new Error(`Sheets write error: ${data.error.message}`);
  }

  return { updatedRows: data.updatedRows || rows.length };
}

/**
 * Replace full sheet contents while writing data in chunks.
 * This reduces payload spikes and request failures for large syncs.
 */
export async function writeToSheetChunked(
  userId: string,
  spreadsheetId: string,
  sheetName: string,
  columns: string[],
  rows: (string | number | null)[][],
  chunkSize: number = 2000,
  explicitCreds?: any,
): Promise<{ updatedRows: number }> {
  const token = await refreshIfNeeded(userId, explicitCreds);
  const stagingName = `__staging_${sheetName}_${Date.now()}`;

  // Create staging tab to avoid destructive clear-first writes on the live tab.
  const addSheetRes = await fetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: stagingName } } }],
    }),
  });
  const addSheetData = await addSheetRes.json();
  if (addSheetData.error) {
    throw new Error(`Sheets staging tab create error: ${addSheetData.error.message}`);
  }
  const stagingSheetId = addSheetData.replies?.[0]?.addSheet?.properties?.sheetId as number | undefined;
  if (typeof stagingSheetId !== 'number') {
    throw new Error('Sheets staging tab create error: missing staging sheet id');
  }

  // Header write to staging tab
  const headerRange = `${stagingName}!A1`;
  const headerRes = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [columns] }),
    },
  );
  const headerData = await headerRes.json();
  if (headerData.error) {
    throw new Error(`Sheets header write error: ${headerData.error.message}`);
  }

  let updatedRows = 1;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows
      .slice(i, i + chunkSize)
      .map((row) => row.map((v) => (v === null ? '' : v)) as (string | number)[]);
    if (chunk.length === 0) continue;

    const appendRes = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(`${stagingName}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: chunk }),
      },
    );

    const appendData = await appendRes.json();
    if (appendData.error) {
      throw new Error(`Sheets chunk append error: ${appendData.error.message}`);
    }

    updatedRows += appendData.updates?.updatedRows || chunk.length;
  }

  // Swap staging tab into the live tab name.
  const metaRes = await fetch(`${SHEETS_BASE}/${spreadsheetId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const metaData = await metaRes.json();
  if (metaData.error) {
    throw new Error(`Sheets metadata read error: ${metaData.error.message}`);
  }

  const sheets = (metaData.sheets as any[]) || [];
  const currentTarget = sheets.find((s: any) => s?.properties?.title === sheetName);
  const currentTargetId = currentTarget?.properties?.sheetId as number | undefined;
  const backupName = `__backup_${sheetName}_${Date.now()}`;

  const swapRequests: any[] = [];
  if (typeof currentTargetId === 'number') {
    swapRequests.push({
      updateSheetProperties: {
        properties: { sheetId: currentTargetId, title: backupName },
        fields: 'title',
      },
    });
  }

  swapRequests.push({
    updateSheetProperties: {
      properties: { sheetId: stagingSheetId, title: sheetName },
      fields: 'title',
    },
  });

  if (typeof currentTargetId === 'number') {
    swapRequests.push({ deleteSheet: { sheetId: currentTargetId } });
  }

  const swapRes = await fetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests: swapRequests }),
  });
  const swapData = await swapRes.json();
  if (swapData.error) {
    throw new Error(`Sheets staging swap error: ${swapData.error.message}`);
  }

  return { updatedRows };
}

/**
 * Append rows to a sheet tab (add after existing data).
 */
export async function appendToSheet(
  userId: string,
  spreadsheetId: string,
  sheetName: string,
  rows: (string | number)[][],
  explicitCreds?: any,
): Promise<{ updatedRows: number }> {
  const token = await refreshIfNeeded(userId, explicitCreds);
  const range = `${sheetName}!A1`;

  const res = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    },
  );

  const data = await res.json();
  if (data.error) {
    throw new Error(`Sheets append error: ${data.error.message}`);
  }

  return { updatedRows: data.updates?.updatedRows || rows.length };
}

/**
 * Premium Polish: Format a sheet with branding and professional styling.
 */
export async function formatPremiumSheet(opts: {
    userId: string;
    spreadsheetId: string;
    sheetName: string;
    clientName?: string;
    rowCount: number;
    colCount: number;
    explicitCreds?: any;
}) {
    const token = await refreshIfNeeded(opts.userId, opts.explicitCreds);
    
    // 1. Get sheet ID
    const metaRes = await fetch(`${SHEETS_BASE}/${opts.spreadsheetId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const meta = await metaRes.json();
    const sheet = meta.sheets.find((s: any) => s.properties.title === opts.sheetName);
    if (!sheet) return;
    const sheetId = sheet.properties.sheetId;

    // 2. Apply formatting (Alternating colors + Bold Header + Freeze Top Row)
    const requests = [
        // Bold headers
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } } },
                fields: 'userEnteredFormat(textFormat,backgroundColor)'
            }
        },
        // Freeze header
        {
            updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: 'gridProperties.frozenRowCount'
            }
        },
        // Alternating colors
        {
            addConditionalFormatRule: {
                rule: {
                    ranges: [{ sheetId, startRowIndex: 1, endRowIndex: opts.rowCount + 1 }],
                    booleanRule: {
                        condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=ISEVEN(ROW())' }] },
                        format: { backgroundColor: { red: 0.98, green: 0.98, blue: 0.98 } }
                    }
                },
                index: 0
            }
        }
    ];

    await fetch(`${SHEETS_BASE}/${opts.spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
    });
}
