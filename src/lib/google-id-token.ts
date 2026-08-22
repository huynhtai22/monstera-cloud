/**
 * Verify a Google ID token using Google's tokeninfo endpoint.
 *
 * Security invariants (all fail closed):
 * - `aud` must be a non-empty string that EXACTLY equals one configured,
 *   allowlisted OAuth client ID. There are deliberately no suffix, substring,
 *   wildcard, or "looks like a Google client ID" fallbacks: a token minted for
 *   any other application must never authenticate here (cross-client
 *   substitution).
 * - If no audience allowlist resolves (GOOGLE_ID_TOKEN_AUDIENCES empty and no
 *   documented fallback client IDs configured), verification fails.
 * - `iss` must be present and exactly equal to an allowed issuer
 *   (default: `accounts.google.com` or `https://accounts.google.com`).
 * - `exp` must be present, numeric, and strictly in the future.
 * - A verified, non-empty `email` claim is required.
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

/**
 * Resolve acceptable audiences from env. An empty result means "no audiences
 * configured"; verifyGoogleIdToken fails closed in that case.
 */
export function getGoogleIdTokenAudienceAllowlist(): string[] {
  // Preferred: explicitly define allowlist in production
  const explicit = splitCsvEnv("GOOGLE_ID_TOKEN_AUDIENCES");
  if (explicit.length > 0) return explicit;

  // Documented fallbacks: accept these client IDs only as exact, non-empty
  // values. The verifier performs exact matching and rejects when none resolve.
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

/** Coerce tokeninfo's `exp` (number or numeric string) into seconds, else null. */
function parseNumericClaim(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function verifyGoogleIdToken(idToken: string, opts?: {
  /** Acceptable OAuth client IDs (audiences). `aud` must match one exactly. Falls back to env allowlist; fails closed when empty. */
  audiences?: string[];
  /** Acceptable issuers. Defaults to the canonical Google accounts issuers. */
  issuers?: string[];
}): Promise<GoogleIdTokenVerification | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const claims = data as Record<string, unknown>;

    const email = claims.email;
    const emailVerified = claims.email_verified;
    const exp = parseNumericClaim(claims.exp);
    const aud = claims.aud;
    const iss = claims.iss;

    if (typeof email !== "string" || !email) return null;
    if (String(emailVerified) !== "true") return null;

    // `exp` is mandatory and must be strictly in the future.
    if (exp === null || exp * 1000 <= Date.now()) return null;

    // `iss` is mandatory and must exactly match an allowed issuer.
    if (typeof iss !== "string" || !iss) return null;
    const issuers = (opts?.issuers ?? []).length
      ? new Set(opts!.issuers)
      : DEFAULT_ISSUERS;
    if (!issuers.has(iss)) return null;

    // Exact-match audience allowlisting, mandatory. Never infer acceptance
    // from the shape of the client ID.
    const audiences = (
      opts?.audiences !== undefined ? opts.audiences : getGoogleIdTokenAudienceAllowlist()
    )
      .map((a) => (typeof a === "string" ? a.trim() : ""))
      .filter(Boolean);
    if (audiences.length === 0) return null;
    if (typeof aud !== "string" || !aud || !audiences.includes(aud)) return null;

    return { email, aud, iss };
  } catch {
    return null;
  }
}
