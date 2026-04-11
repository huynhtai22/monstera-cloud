import prisma from '@/lib/prisma';
import { encrypt, safeDecrypt } from '@/lib/encryption';
import { copySpreadsheet, createSpreadsheet, writeToSheet } from '@/lib/google-sheets';

export async function loadToGoogleSheets(opts: {
  userId: string;
  pipeline: any;
  columns: string[];
  rows: (string | number | null)[][];
}): Promise<{ spreadsheetId: string }> {
  const destCreds = JSON.parse(safeDecrypt(opts.pipeline.destinationConnection.credentials));
  const spreadsheetId = destCreds?.spreadsheetId as string | undefined;
  const templateSpreadsheetId = destCreds?.templateSpreadsheetId as string | undefined;
  const sheetName = (destCreds?.sheetName as string | undefined) ?? 'Sheet1';

  let actualSpreadsheetId = spreadsheetId;
  if (!actualSpreadsheetId || actualSpreadsheetId === 'target_spreadsheet') {
    const title = `Monstera Sync: ${opts.pipeline.name}`;
    const created = templateSpreadsheetId
      ? await copySpreadsheet(opts.userId, templateSpreadsheetId, title)
      : await createSpreadsheet(opts.userId, title);
    actualSpreadsheetId = created.spreadsheetId;
    await prisma.connection.update({
      where: { id: opts.pipeline.destinationConnection.id },
      data: {
        credentials: encrypt(JSON.stringify({ ...destCreds, spreadsheetId: actualSpreadsheetId })),
      },
    });
  }

  // Replace contents (clear + write)
  await writeToSheet(
    opts.userId,
    actualSpreadsheetId,
    sheetName,
    opts.columns,
    opts.rows.map((r) => r.map((v) => (v === null ? '' : v)) as (string | number)[]),
  );

  return { spreadsheetId: actualSpreadsheetId };
}

