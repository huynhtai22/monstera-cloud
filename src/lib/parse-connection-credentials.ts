/**
 * Parse JSON stored on Connection.credentials after decrypt (or plaintext legacy).
 * Tolerates UTF-8 BOM and accidental double-pasted JSON blobs like `{}{...}` which
 * would otherwise throw "Unexpected non-whitespace character after JSON".
 */
export function parseConnectionCredentialsJson(plaintext: string): Record<string, unknown> {
  const t = plaintext.trim().replace(/^\uFEFF/, "");
  try {
    const v = JSON.parse(t);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    throw new SyntaxError("Expected a JSON object for connection credentials.");
  } catch {
    const start = t.indexOf("{");
    if (start === -1) {
      throw new SyntaxError(
        "Stored credentials do not contain a JSON object. Reconnect this source on the Sources page.",
      );
    }
    let depth = 0;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          const chunk = t.slice(start, i + 1);
          try {
            const inner = JSON.parse(chunk);
            if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
              return inner as Record<string, unknown>;
            }
          } catch {
            break;
          }
        }
      }
    }
    throw new SyntaxError(
      'Could not parse stored credentials as JSON (corrupted or invalid). Disconnect and reconnect this source.',
    );
  }
}
