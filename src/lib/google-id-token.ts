/**
 * Verify a Google ID token using Google's tokeninfo endpoint, with optional
 * audience/issuer validation.
 *
 * Note: tokeninfo is network-dependent; for higher assurance you can migrate
 * to local JWT validation against Google's JWKS later.
 */

export type GoogleIdTokenVerification = {
  email: string;
  aud?: string;
  iss?: string;
};

const DEFAULT_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

function splitCsvEnv(name: string): string[] {
  const raw = (process.env[name] || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolve acceptable audiences from env. */
export function getGoogleIdTokenAudienceAllowlist(): string[] {
  // Preferred: explicitly define allowlist in production
  const explicit = splitCsvEnv("GOOGLE_ID_TOKEN_AUDIENCES");
  if (explicit.length > 0) return explicit;

  // Fallbacks: accept known client IDs if present
  const fallback = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ADS_CLIENT_ID,
    process.env.LOOKER_OAUTH_CLIENT_ID,
    process.env.GOOGLE_ADDON_CLIENT_ID,
  ]
    .map((v) => (v || "").trim())
    .filter(Boolean);

  return fallback;
}

export async function verifyGoogleIdToken(idToken: string, opts?: {
  /** Acceptable OAuth client IDs (audiences). If provided, aud must match. */
  audiences?: string[];
  /** Acceptable issuers. Defaults to Google accounts issuers. */
  issuers?: string[];
}): Promise<GoogleIdTokenVerification | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;

    const email = data.email;
    const emailVerified = data.email_verified;
    const exp = data.exp;
    const aud = data.aud;
    const iss = data.iss;

    if (typeof email !== "string" || !email) return null;
    if (String(emailVerified) !== "true") return null;
    if (exp && Number(exp) * 1000 < Date.now()) return null;

    const issuers = (opts?.issuers ?? []).length
      ? new Set(opts!.issuers)
      : DEFAULT_ISSUERS;
    if (typeof iss === "string" && iss && !issuers.has(iss)) return null;

    const audiences = opts?.audiences ?? [];
    if (audiences.length === 0 && process.env.NODE_ENV === "production") {
      // Fail closed in production unless audiences are explicitly configured.
      // This prevents accepting ID tokens minted for unrelated OAuth clients.
      return null;
    }
    if (audiences.length > 0) {
      if (typeof aud !== "string" || !audiences.includes(aud)) return null;
    }

    return {
      email,
      aud: typeof aud === "string" ? aud : undefined,
      iss: typeof iss === "string" ? iss : undefined,
    };
  } catch {
    return null;
  }
}

