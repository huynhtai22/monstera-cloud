/**
 * Google Sheets API client — uses stored OAuth tokens from the Account table.
 * Scopes already requested during Google login:
 *   - https://www.googleapis.com/auth/spreadsheets
 *   - https://www.googleapis.com/auth/drive.file
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

export async function getGoogleTokens(userId: string): Promise<GoogleTokens | null> {
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

async function refreshIfNeeded(userId: string): Promise<string> {
  const tokens = await getGoogleTokens(userId);
  if (!tokens) throw new Error('No Google account linked — please log in with Google.');

  const now = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt && tokens.expiresAt > now + 60) {
    return tokens.accessToken;
  }

  // Token expired — refresh it
  if (!tokens.refreshToken) {
    throw new Error('Google token expired and no refresh token available. Please sign out and log in again with Google.');
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

  // Persist the new access token
  await (prisma.account as any).updateMany({
    where: { userId, provider: 'google' },
    data: {
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    },
  });

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
): Promise<SheetInfo> {
  const token = await refreshIfNeeded(userId);

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

/** List spreadsheets the user owns or has edit access to. */
export async function listSpreadsheets(userId: string): Promise<SheetInfo[]> {
  const token = await refreshIfNeeded(userId);

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
): Promise<{ updatedRows: number }> {
  const token = await refreshIfNeeded(userId);

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
 * Append rows to a sheet tab (add after existing data).
 */
export async function appendToSheet(
  userId: string,
  spreadsheetId: string,
  sheetName: string,
  rows: (string | number)[][],
): Promise<{ updatedRows: number }> {
  const token = await refreshIfNeeded(userId);
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
