import { encrypt, isEncrypted } from "@/lib/encryption";

export type CredentialRemediation =
  | { action: "unchanged" }
  | { action: "encrypted"; credentials: string }
  | { action: "reconnect_required"; credentials: string; reason: "missing" | "invalid_json" | "invalid_shape" };

const RECONNECT_MARKER = JSON.stringify({
  __monsteraCredentialState: "reconnect_required",
});

/**
 * Classifies a stored credential without ever returning its plaintext. Valid legacy JSON is
 * encrypted verbatim; invalid values are replaced with an encrypted reconnect marker.
 */
export function remediateStoredCredentials(value: string | null | undefined): CredentialRemediation {
  if (value && isEncrypted(value)) return { action: "unchanged" };
  if (!value?.trim()) {
    return { action: "reconnect_required", credentials: encrypt(RECONNECT_MARKER), reason: "missing" };
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { action: "reconnect_required", credentials: encrypt(RECONNECT_MARKER), reason: "invalid_shape" };
    }
  } catch {
    return { action: "reconnect_required", credentials: encrypt(RECONNECT_MARKER), reason: "invalid_json" };
  }

  return { action: "encrypted", credentials: encrypt(value) };
}
