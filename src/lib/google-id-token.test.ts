import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  getGoogleIdTokenAudienceAllowlist,
  verifyGoogleIdToken,
  type GoogleIdTokenVerification,
} from "./google-id-token";

const ALLOWED_AUD = "addon-client-123.apps.googleusercontent.com";
const OTHER_GOOGLE_AUD = "attacker-app-999.apps.googleusercontent.com";
const FUTURE_EXP_SECONDS = Math.floor(Date.now() / 1000) + 3600;

const AUDIENCE_ENV_VARS = [
  "GOOGLE_ID_TOKEN_AUDIENCES",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_ID",
  "LOOKER_OAUTH_CLIENT_ID",
  "GOOGLE_ADDON_CLIENT_ID",
] as const;

function clearAudienceConfig(): void {
  for (const key of AUDIENCE_ENV_VARS) delete process.env[key];
}

function stubResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
  } as unknown as Response;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aud: ALLOWED_AUD,
    iss: "https://accounts.google.com",
    exp: FUTURE_EXP_SECONDS,
    email: "analyst@example.com",
    email_verified: true,
    sub: "1089155googleusercontent-filler-not-relevant",
    ...overrides,
  };
}

function allowExactAllowedAudience(): void {
  process.env.GOOGLE_ID_TOKEN_AUDIENCES = ALLOWED_AUD;
}

async function verifyWithMockedTokeninfo(
  claimsOrError:
    | { kind: "claims"; claims: Record<string, unknown> }
    | { kind: "httpStatus"; status: number }
    | { kind: "networkError"; message: string }
    | { kind: "malformedJson" }
    | { kind: "jsonArray"; value: unknown[] },
  opts?: Parameters<typeof verifyGoogleIdToken>[1]
): Promise<GoogleIdTokenVerification | null> {
  const impl = async (): Promise<Response> => {
    switch (claimsOrError.kind) {
      case "claims":
        return stubResponse(claimsOrError.claims);
      case "httpStatus":
        return stubResponse({}, false);
      case "networkError":
        throw new Error(claimsOrError.message);
      case "malformedJson":
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token in JSON");
          },
        } as unknown as Response;
      case "jsonArray":
        return stubResponse(claimsOrError.value);
    }
  };
  const restore = mock.method(globalThis, "fetch", impl);
  try {
    return await verifyGoogleIdToken("header.payload.signature", opts);
  } finally {
    restore.mock.restore();
  }
}

describe("verifyGoogleIdToken (hardened)", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of AUDIENCE_ENV_VARS) savedEnv[key] = process.env[key];
    clearAudienceConfig();
  });

  afterEach(() => {
    for (const key of AUDIENCE_ENV_VARS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("audience matching", () => {
    it("accepts a token whose aud exactly equals an allowlisted client ID", async () => {
      allowExactAllowedAudience();
      const result = await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims() });
      assert.ok(result);
      assert.equal(result!.email, "analyst@example.com");
      assert.equal(result!.aud, ALLOWED_AUD);
    });

    it("accepts the alternate canonical issuer and numeric-string exp", async () => {
      allowExactAllowedAudience();
      const result = await verifyWithMockedTokeninfo({
        kind: "claims",
        claims: validClaims({ iss: "accounts.google.com", exp: String(FUTURE_EXP_SECONDS) }),
      });
      assert.ok(result);
      assert.equal(result!.iss, "accounts.google.com");
    });

    it("rejects a different, well-formed Google OAuth client ID that is not allowlisted", async () => {
      allowExactAllowedAudience();
      const result = await verifyWithMockedTokeninfo({
        kind: "claims",
        claims: validClaims({ aud: OTHER_GOOGLE_AUD }),
      });
      assert.equal(result, null);
    });

    it("rejects an aud that merely ends with .apps.googleusercontent.com (no shape-based fallback)", async () => {
      allowExactAllowedAudience();
      const result = await verifyWithMockedTokeninfo({
        kind: "claims",
        claims: validClaims({ aud: "totally-unrelated.apps.googleusercontent.com" }),
      });
      assert.equal(result, null);
    });

    it("rejects an aud that merely contains googleusercontent.com", async () => {
      allowExactAllowedAudience();
      const result = await verifyWithMockedTokeninfo({
        kind: "claims",
        claims: validClaims({ aud: "https://evil.example/steal?client=googleusercontent.com" }),
      });
      assert.equal(result, null);
    });

    it("rejects a missing aud", async () => {
      allowExactAllowedAudience();
      const claims = validClaims();
      delete claims.aud;
      const result = await verifyWithMockedTokeninfo({ kind: "claims", claims });
      assert.equal(result, null);
    });

    it("rejects an empty-string aud", async () => {
      allowExactAllowedAudience();
      const result = await verifyWithMockedTokeninfo({
        kind: "claims",
        claims: validClaims({ aud: "" }),
      });
      assert.equal(result, null);
    });

    it("fails closed when no audience allowlist is configured", async () => {
      // No GOOGLE_ID_TOKEN_AUDIENCES, no fallback client IDs.
      const result = await verifyWithMockedTokeninfo({
        kind: "claims",
        claims: validClaims({ aud: OTHER_GOOGLE_AUD }),
      });
      assert.equal(result, null);
    });

    it("fails closed when GOOGLE_ID_TOKEN_AUDIENCES is configured but empty", async () => {
      process.env.GOOGLE_ID_TOKEN_AUDIENCES = "";
      const result = await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims() });
      assert.equal(result, null);
    });

    it("fails closed when callers pass an explicitly empty audiences array", async () => {
      const result = await verifyWithMockedTokeninfo(
        { kind: "claims", claims: validClaims() },
        { audiences: [] }
      );
      assert.equal(result, null);
    });

    it("uses documented fallback env client IDs as exact audiences only", async () => {
      process.env.LOOKER_OAUTH_CLIENT_ID = ALLOWED_AUD;
      const result = await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims() });
      assert.ok(result);

      process.env.LOOKER_OAUTH_CLIENT_ID = OTHER_GOOGLE_AUD;
      const rejected = await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims() });
      assert.equal(rejected, null);
    });

    it("honors custom issuers via opts while keeping exact audience enforcement", async () => {
      allowExactAllowedAudience();
      const accepted = await verifyWithMockedTokeninfo(
        { kind: "claims", claims: validClaims({ iss: "https://accounts.example.internal" }) },
        { issuers: ["https://accounts.example.internal"] }
      );
      assert.ok(accepted);

      // Custom issuer must not weaken audience matching.
      const rejected = await verifyWithMockedTokeninfo(
        { kind: "claims", claims: validClaims({ iss: "https://accounts.example.internal", aud: OTHER_GOOGLE_AUD }) },
        { issuers: ["https://accounts.example.internal"] }
      );
      assert.equal(rejected, null);
    });
  });

  describe("standard claims", () => {
    beforeEach(() => allowExactAllowedAudience());

    it("rejects a missing exp", async () => {
      const claims = validClaims();
      delete claims.exp;
      assert.equal(await verifyWithMockedTokeninfo({ kind: "claims", claims }), null);
    });

    it("rejects a non-numeric exp", async () => {
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims({ exp: "not-a-number" }) }),
        null
      );
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims({ exp: "" }) }),
        null
      );
    });

    it("rejects an expired exp", async () => {
      const expired = Math.floor(Date.now() / 1000) - 60;
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims({ exp: expired }) }),
        null
      );
    });

    it("rejects an exp that is not strictly in the future", async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims({ exp: nowSeconds }) }),
        null
      );
    });

    it("rejects a missing iss", async () => {
      const claims = validClaims();
      delete claims.iss;
      assert.equal(await verifyWithMockedTokeninfo({ kind: "claims", claims }), null);
    });

    it("rejects an invalid iss", async () => {
      assert.equal(
        await verifyWithMockedTokeninfo({
          kind: "claims",
          claims: validClaims({ iss: "https://evil.example/accounts" }),
        }),
        null
      );
      assert.equal(
        await verifyWithMockedTokeninfo({
          kind: "claims",
          claims: validClaims({ iss: "accounts.google.com.evil.test" }),
        }),
        null
      );
    });

    it("rejects an unverified or missing email claim", async () => {
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims({ email_verified: false }) }),
        null
      );
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims({ email_verified: "false" }) }),
        null
      );
      const noEmail = validClaims();
      delete noEmail.email;
      assert.equal(await verifyWithMockedTokeninfo({ kind: "claims", claims: noEmail }), null);
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "claims", claims: validClaims({ email: "" }) }),
        null
      );
    });
  });

  describe("tokeninfo transport failures", () => {
    beforeEach(() => allowExactAllowedAudience());

    it("returns null on network failure", async () => {
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "networkError", message: "getaddrinfo ENOTFOUND" }),
        null
      );
    });

    it("returns null on non-OK tokeninfo responses", async () => {
      assert.equal(await verifyWithMockedTokeninfo({ kind: "httpStatus", status: 400 }), null);
    });

    it("does not trust malformed JSON responses", async () => {
      assert.equal(await verifyWithMockedTokeninfo({ kind: "malformedJson" }), null);
    });

    it("does not trust JSON array responses", async () => {
      assert.equal(
        await verifyWithMockedTokeninfo({ kind: "jsonArray", value: [validClaims()] }),
        null
      );
    });
  });
});

const FAKE_JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

describe("Sheets and Looker call sites fail closed without configuration", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of AUDIENCE_ENV_VARS) savedEnv[key] = process.env[key];
    clearAudienceConfig();
    process.env.DATABASE_URL ||= "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";
  });

  afterEach(() => {
    for (const key of AUDIENCE_ENV_VARS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("resolves an empty allowlist when configuration is absent", () => {
    assert.deepEqual(getGoogleIdTokenAudienceAllowlist(), []);
  });

  it("/api/v1/sheets/auth returns 401 even when tokeninfo returns a fully valid payload", async () => {
    const restore = mock.method(globalThis, "fetch", async () => stubResponse(validClaims()));
    try {
      const { POST } = await import("@/app/api/v1/sheets/auth/route");
      const req = new Request("http://localhost:3000/api/v1/sheets/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ googleToken: FAKE_JWT }),
      });
      const res = await POST(req);
      assert.equal(res.status, 401);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, "invalid_token");
    } finally {
      restore.mock.restore();
    }
  });

  it("/api/looker-studio returns 401 even when tokeninfo returns a fully valid payload", async () => {
    const restore = mock.method(globalThis, "fetch", async () => stubResponse(validClaims()));
    try {
      const { GET } = await import("@/app/api/looker-studio/route");
      const { NextRequest } = await import("next/server");
      const req = new NextRequest("http://localhost:3000/api/looker-studio", {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
      });
      const res = await GET(req);
      assert.equal(res.status, 401);
    } finally {
      restore.mock.restore();
    }
  });
});
