/**
 * Google Sheets add-on: treat specific Google account emails as Professional
 * for Marketplace review (or internal QA) without changing LemonSqueezy billing.
 *
 * Set MONSTERA_SHEETS_REVIEW_EMAILS in Vercel (comma-separated, case-insensitive).
 * Users must still exist in the database and have workspace + connections as usual.
 */

function normalizedReviewerSet(): Set<string> {
  const raw = (process.env.MONSTERA_SHEETS_REVIEW_EMAILS ?? '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isSheetsReviewerEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return normalizedReviewerSet().has(email.trim().toLowerCase());
}

/** Effective plan for Sheets auth + query gates. */
export function effectiveSheetsPlan(
  dbPlan: string,
  googleEmail: string | undefined | null,
): string {
  if (isSheetsReviewerEmail(googleEmail)) return 'professional';
  return dbPlan;
}
