/**
 * Resolves the Google account email for a short-lived OAuth access token
 * (e.g. from the GSI OAuth2 token client). Used for step-up before revealing secrets.
 */
export async function getEmailFromGoogleAccessToken(
  accessToken: string
): Promise<string | null> {
  const token = accessToken.trim();
  if (!token) return null;
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return typeof data.email === "string" ? data.email : null;
  } catch {
    return null;
  }
}

export function emailsEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
