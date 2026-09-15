import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { metaAdsClient } from "./meta-ads";
import { MetaAdsOAuthAdapter } from "./oauth-framework/providers/meta-ads";
import { isProviderConfigured, isProviderEnabled, getAvailableProviders } from "./oauth-framework/registry";
import { TestCertificationHarness } from "./ad-certification/test-simulation-adapter";
import { NextRequest } from "next/server";
import { GET as connectGET } from "@/app/api/auth/connect/route";
import { setAuthSessionOverride } from "./auth-session";

/**
 * Facebook Login for Business authorization boundary.
 *
 * The generated login URL must carry the reviewed configuration ID
 * (`META_ADS_LOGIN_CONFIG_ID`) instead of a legacy `scope`. Permission selection
 * is owned by that configuration, so `scope` must be absent.
 *
 * Every identifier in this file is synthetic. Real configuration IDs, app
 * secrets and tokens are never read, printed or persisted here.
 */

const SYNTHETIC_APP_ID = "100000000000001";
const SYNTHETIC_APP_SECRET = "synthetic-app-secret";
const SYNTHETIC_CONFIG_ID = "1234567890123457";
const SYNTHETIC_REDIRECT_URI = "https://example.test/api/auth/callback?provider=meta_ads";
const SYNTHETIC_STATE = "synthetic-signed-state-abc123";
/** Distinctive malformed value so leak assertions are meaningful. */
const SYNTHETIC_BAD_CONFIG_ID = "SYNTHETIC-BAD-CONFIG-98765";

const FORBIDDEN_PERMISSIONS = [
  "ads_read",
  "ads_management",
  "business_management",
  "pages_manage_ads",
  "instagram_basic",
  "leads_retrieval",
  "pages_messaging",
] as const;

const trackedKeys = [
  "META_ADS_APP_ID",
  "META_ADS_APP_SECRET",
  "META_ADS_LOGIN_CONFIG_ID",
] as const;

const originalEnv = Object.fromEntries(
  trackedKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof trackedKeys)[number], string | undefined>;

type RawFetch = typeof fetch;

let originalFetch: RawFetch;
let recordedUrls: string[];
let consoleOutput: string[];
let consoleRestore: () => void;

function setMetaEnv(overrides: Partial<Record<(typeof trackedKeys)[number], string>> = {}): void {
  process.env.META_ADS_APP_ID = SYNTHETIC_APP_ID;
  process.env.META_ADS_APP_SECRET = SYNTHETIC_APP_SECRET;
  delete process.env.META_ADS_LOGIN_CONFIG_ID;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Fails the test if any network request is attempted. */
function installOfflineFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    recordedUrls.push(resolveRequestUrl(input));
    throw new Error("Network access is disabled in tests");
  }) as RawFetch;
}

function installJsonFetch(handler: (url: string) => unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = resolveRequestUrl(input);
    recordedUrls.push(url);
    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as RawFetch;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function authorizeUrl(): string {
  return metaAdsClient.getAuthorizeUrl(SYNTHETIC_STATE, SYNTHETIC_REDIRECT_URI);
}

function captureAuthorizeUrlError(): { message: string; code: string | undefined } {
  try {
    authorizeUrl();
  } catch (err) {
    const error = err as { message?: string; code?: string };
    return { message: error.message ?? "", code: error.code };
  }
  throw new assert.AssertionError({
    message: "Expected authorization URL construction to fail closed, but it succeeded",
  });
}

function assertNoLeak(value: string): void {
  assert.equal(consoleOutput.some((line) => line.includes(value)), false, "logs must not echo the configuration value");
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  recordedUrls = [];
  consoleOutput = [];
  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = ((...args: unknown[]) => {
      consoleOutput.push(args.map((arg) => String(arg)).join(" "));
    }) as typeof console.log;
  }
  consoleRestore = () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  };
  installOfflineFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  consoleRestore();
  setAuthSessionOverride(null);
  for (const key of trackedKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Meta Ads Facebook Login for Business authorization URL", () => {
  it("carries config_id exactly once, sourced only from META_ADS_LOGIN_CONFIG_ID", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });

    const raw = authorizeUrl();
    const url = new URL(raw);

    assert.equal(countOccurrences(raw, "config_id"), 1, "config_id must appear exactly once");
    assert.deepEqual(url.searchParams.getAll("config_id"), [SYNTHETIC_CONFIG_ID]);
    assert.notEqual(
      url.searchParams.get("config_id"),
      SYNTHETIC_APP_ID,
      "config_id must never fall back to the app ID",
    );
    assert.equal(recordedUrls.length, 0, "URL construction must not contact any provider");
  });

  it("omits scope entirely so the reviewed configuration owns permission selection", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });

    const raw = authorizeUrl();
    const url = new URL(raw);

    assert.equal(url.searchParams.has("scope"), false, "scope must be absent");
    assert.equal(countOccurrences(raw, "scope"), 0, "no scope parameter may appear anywhere");
    for (const permission of FORBIDDEN_PERMISSIONS) {
      assert.equal(raw.includes(permission), false, `permission ${permission} must not be requested`);
    }
  });

  it("requests an authorization code with the configuration response type overridden", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });

    const raw = authorizeUrl();
    const url = new URL(raw);

    assert.deepEqual(url.searchParams.getAll("response_type"), ["code"]);
    assert.deepEqual(url.searchParams.getAll("override_default_response_type"), ["true"]);
    // Exact ordered parameter set: proves there are no duplicates, no extra
    // parameters, and (again) that scope never appears.
    assert.deepEqual([...url.searchParams.keys()], [
      "client_id",
      "redirect_uri",
      "state",
      "config_id",
      "response_type",
      "override_default_response_type",
    ]);
  });

  it("keeps client_id, redirect_uri and signed state exactly once", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });

    const raw = authorizeUrl();
    const url = new URL(raw);

    assert.deepEqual(url.searchParams.getAll("client_id"), [SYNTHETIC_APP_ID]);
    assert.deepEqual(url.searchParams.getAll("redirect_uri"), [SYNTHETIC_REDIRECT_URI]);
    assert.deepEqual(url.searchParams.getAll("state"), [SYNTHETIC_STATE]);
    assert.equal(countOccurrences(raw, "client_id="), 1);
    assert.equal(countOccurrences(raw, "state="), 1);
    assert.equal(url.hostname, "www.facebook.com");
    assert.equal(url.pathname, "/dialog/oauth");
  });

  it("trims surrounding whitespace and accepts only the numeric Meta identifier shape", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: `  ${SYNTHETIC_CONFIG_ID}\n` });

    const url = new URL(authorizeUrl());

    assert.equal(url.searchParams.get("config_id"), SYNTHETIC_CONFIG_ID);
    assert.equal(recordedUrls.length, 0);
  });
});

describe("Meta Ads configuration fail-closed behaviour", () => {
  it("fails closed before redirect construction or provider contact when the ID is missing", () => {
    setMetaEnv();

    const { message, code } = captureAuthorizeUrlError();

    assert.match(message, /META_ADS_LOGIN_CONFIG_ID/);
    assert.equal(code, "configuration_error");
    assert.equal(recordedUrls.length, 0, "no provider contact may occur when failing closed");
    assert.equal(consoleOutput.some((line) => line.includes("ads_read")), false);
  });

  it("fails closed for empty, whitespace-only and malformed configuration IDs", () => {
    const rejected: Array<{ value: string; label: string }> = [
      { value: "", label: "empty" },
      { value: "   ", label: "spaces" },
      { value: "\t\n ", label: "whitespace" },
      { value: SYNTHETIC_BAD_CONFIG_ID, label: "non-numeric" },
      { value: `12${SYNTHETIC_BAD_CONFIG_ID}`, label: "mixed alphanumeric" },
      { value: "123 456", label: "internal space" },
      { value: "-123456789", label: "negative" },
      { value: "1.5", label: "decimal" },
      { value: "1e5", label: "exponent" },
      { value: "1,234", label: "grouped digits" },
      { value: "0x1f", label: "hex literal" },
      { value: "１２３４５", label: "full-width digits" },
      { value: "true", label: "boolean literal" },
      { value: "null", label: "null literal" },
    ];

    for (const { value, label } of rejected) {
      setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: value });

      const { message, code } = captureAuthorizeUrlError();

      assert.match(message, /META_ADS_LOGIN_CONFIG_ID/, `${label} must be refused by name`);
      assert.equal(code, "configuration_error", `${label} must be a configuration error`);
      if (value.trim().length > 0) {
        assert.equal(message.includes(value.trim()), false, `${label} must not echo the supplied value`);
        assertNoLeak(value.trim());
      }
    }

    assert.equal(recordedUrls.length, 0, "no provider contact may occur when failing closed");
  });

  it("never echoes the supplied configuration value in errors or logs", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_BAD_CONFIG_ID });

    const { message } = captureAuthorizeUrlError();

    assert.equal(message.includes(SYNTHETIC_BAD_CONFIG_ID), false);
    assertNoLeak(SYNTHETIC_BAD_CONFIG_ID);
    assert.equal(recordedUrls.length, 0);
  });

  it("leaves unrelated Meta client operations usable while the ID is absent", async () => {
    setMetaEnv();
    installJsonFetch(() => ({ data: [{ id: "act_1", name: "Synthetic", currency: "USD", account_status: 1 }] }));

    const accounts = await metaAdsClient.getAdAccounts("synthetic-token");

    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, "act_1");
    assert.equal(recordedUrls.length, 1, "only the ad account lookup may reach the network stub");
    assert.equal(recordedUrls[0].includes("config_id"), false);
    assert.equal(recordedUrls[0].includes("scope"), false);
  });
});

describe("Meta Ads callback compatibility", () => {
  const SYNTHETIC_AD_ACCOUNT = {
    id: "act_1234567890",
    name: "Synthetic Ad Account",
    currency: "USD",
    account_status: 1,
  };

  function installOAuthStubFetch(): void {
    installJsonFetch((url) => {
      if (url.includes("/me/adaccounts")) return { data: [SYNTHETIC_AD_ACCOUNT] };
      if (url.includes("grant_type=fb_exchange_token")) {
        return { access_token: "synthetic-long-lived", expires_in: 5183944, token_type: "bearer" };
      }
      if (url.includes("/oauth/access_token")) {
        return { access_token: "synthetic-short-lived", expires_in: 3600, token_type: "bearer" };
      }
      throw new Error(`Unexpected request in test stub: ${url}`);
    });
  }

  it("still exchanges the authorization code and discovers accounts through the user-token flow", async () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });
    installOAuthStubFetch();
    const adapter = new MetaAdsOAuthAdapter();

    const result = await adapter.exchangeCode({
      code: "synthetic-authorization-code",
      redirectUri: SYNTHETIC_REDIRECT_URI,
      metadata: { workspaceId: "ws_synthetic", userId: "user_synthetic" },
    });

    assert.equal(result.credentials.accessToken, "synthetic-long-lived");
    assert.deepEqual(result.metadata.accountIdentifiers, [SYNTHETIC_AD_ACCOUNT.id]);
    assert.equal(recordedUrls.length, 3, "code exchange, long-lived upgrade, account discovery");

    const [shortExchange, longLivedUpgrade, accountDiscovery] = recordedUrls;
    assert.match(shortExchange, /\/oauth\/access_token/);
    assert.equal(shortExchange.includes("code=synthetic-authorization-code"), true);
    assert.equal(shortExchange.includes(encodeURIComponent(SYNTHETIC_REDIRECT_URI).slice(0, 20)), true);
    assert.match(longLivedUpgrade, /grant_type=fb_exchange_token/);
    assert.match(longLivedUpgrade, /fb_exchange_token=synthetic-short-lived/);
    assert.match(accountDiscovery, /\/me\/adaccounts/);

    for (const url of recordedUrls) {
      assert.equal(url.includes("config_id"), false, "exchange traffic must not carry config_id");
      assert.equal(url.includes("scope"), false, "exchange traffic must not request scopes");
    }
  });

  it("routes the live connect flow through the configuration-based URL", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });
    const adapter = new MetaAdsOAuthAdapter();

    const url = new URL(
      adapter.buildAuthorizeUrl({
        workspaceId: "ws_synthetic",
        redirectUri: SYNTHETIC_REDIRECT_URI,
        state: SYNTHETIC_STATE,
      }),
    );

    assert.equal(adapter.id, "meta_ads");
    assert.equal(adapter.authType, "oauth");
    assert.deepEqual(url.searchParams.getAll("config_id"), [SYNTHETIC_CONFIG_ID]);
    assert.deepEqual(url.searchParams.getAll("override_default_response_type"), ["true"]);
    assert.equal(url.searchParams.has("scope"), false);
    assert.equal(recordedUrls.length, 0, "no provider contact while building the URL");
  });

  it("keeps reconnect authorization deterministic and independent of callback state", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });

    const first = authorizeUrl();
    const second = authorizeUrl();

    assert.equal(first, second, "the URL must be a pure function of state and redirect URI");
    assert.equal(new URL(first).searchParams.get("config_id"), SYNTHETIC_CONFIG_ID);
    assert.equal(recordedUrls.length, 0);
  });
});

describe("Meta Ads provider configuration and readiness contracts", () => {
  it("rejects isProviderConfigured when META_ADS_APP_ID is missing", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });
    delete process.env.META_ADS_APP_ID;
    delete process.env.META_APP_ID;
    assert.equal(isProviderConfigured("meta_ads"), false);
  });

  it("rejects isProviderConfigured when META_ADS_APP_SECRET is missing", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });
    delete process.env.META_ADS_APP_SECRET;
    delete process.env.META_APP_SECRET;
    assert.equal(isProviderConfigured("meta_ads"), false);
  });

  it("rejects isProviderConfigured when META_ADS_LOGIN_CONFIG_ID is missing", () => {
    setMetaEnv(); // sets valid app_id & secret, but deletes config_id
    assert.equal(isProviderConfigured("meta_ads"), false);
  });

  it("rejects isProviderConfigured for empty, whitespace-only and malformed configuration IDs", () => {
    const invalidValues = [
      "",
      "   ",
      "\t\n",
      "config_12345",
      "12345abc",
      "abc12345",
      "1234-5678",
      "1234.5678",
      "1234 5678",
      "1234\t5678",
      "0x1234",
      "-12345",
      SYNTHETIC_BAD_CONFIG_ID,
    ];

    for (const invalid of invalidValues) {
      setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: invalid });
      assert.equal(
        isProviderConfigured("meta_ads"),
        false,
        `Expected isProviderConfigured("meta_ads") to be false for value: ${JSON.stringify(invalid)}`,
      );
    }
  });

  it("returns true only when App ID, App Secret, and a valid numeric Configuration ID exist", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_CONFIG_ID });
    assert.equal(isProviderConfigured("meta_ads"), true);
  });

  it("handles surrounding whitespace consistently in readiness and URL construction", () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: `  ${SYNTHETIC_CONFIG_ID}  \n` });
    assert.equal(isProviderConfigured("meta_ads"), true);

    const raw = authorizeUrl();
    const url = new URL(raw);
    assert.deepEqual(url.searchParams.getAll("config_id"), [SYNTHETIC_CONFIG_ID]);
  });

  it("preserves configuration checks for other providers", () => {
    assert.equal(typeof isProviderConfigured("tiktok_business"), "boolean");
    assert.equal(typeof isProviderConfigured("amazon"), "boolean");
    assert.equal(typeof isProviderConfigured("google_ads"), "boolean");
    assert.equal(typeof isProviderConfigured("shopee"), "boolean");
    assert.equal(typeof isProviderConfigured("lazada"), "boolean");
    assert.equal(typeof isProviderConfigured("shopify"), "boolean");
  });

  it("blocks ad certification gates when Meta configuration ID is invalid or missing", async () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_BAD_CONFIG_ID });
    const { evidencePack } = await new TestCertificationHarness().executeTestSimulation({
      workspaceId: "ws_meta_test",
      provider: "meta_ads",
      accountId: "act_1234567890",
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      buildId: "test-build-meta",
      evidenceClass: "synthetic_fixture",
    });
    const sandboxGate = evidencePack.gateOutcomes.find((g) => g.gate === "SANDBOX_VERIFIED");
    assert.ok(sandboxGate);
    assert.equal(sandboxGate.status, "BLOCKED");
    assert.equal(sandboxGate.blockerCategory, "MISSING_META_CREDENTIALS");
  });

  it("never echoes the invalid configuration value in certification output or logs", async () => {
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_BAD_CONFIG_ID });
    const { evidencePack, markdownReport } = await new TestCertificationHarness().executeTestSimulation({
      workspaceId: "ws_meta_test",
      provider: "meta_ads",
      accountId: "act_1234567890",
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      buildId: "test-build-meta",
      evidenceClass: "synthetic_fixture",
    });
    assertNoLeak(SYNTHETIC_BAD_CONFIG_ID);
    assert.equal(JSON.stringify(evidencePack).includes(SYNTHETIC_BAD_CONFIG_ID), false);
    assert.equal(markdownReport.includes(SYNTHETIC_BAD_CONFIG_ID), false);
  });

  it("excludes Meta from getAvailableProviders when unconfigured", () => {
    setMetaEnv(); // valid app_id & secret, but no config_id
    const available = getAvailableProviders();
    assert.equal(available.includes("meta_ads"), false);
  });

  it("proves /api/auth/connect rejects invalid Meta configuration before attempt creation, redirect or provider contact", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "synthetic_user_1", email: "user@example.test" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));
    setMetaEnv({ META_ADS_LOGIN_CONFIG_ID: SYNTHETIC_BAD_CONFIG_ID });

    const req = new NextRequest("https://example.test/api/auth/connect?provider=meta_ads&workspaceId=ws_123");
    const res = await connectGET(req);

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.deepEqual(body, { error: 'Provider "meta_ads" is not enabled' });
    assert.equal(recordedUrls.length, 0, "no external provider calls made");
  });
});