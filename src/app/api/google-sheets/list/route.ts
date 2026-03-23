import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listSpreadsheets, getGoogleTokens } from '@/lib/google-sheets';

/**
 * GET /api/google-sheets/list
 * Returns the user's recent Google Sheets (up to 50).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tokens = await getGoogleTokens(session.user.id);
  if (!tokens) {
    return NextResponse.json(
      { error: 'no_google_account', message: 'No Google account linked. Please log in with Google.' },
      { status: 400 },
    );
  }

  try {
    const sheets = await listSpreadsheets(session.user.id);
    return NextResponse.json({ sheets });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
