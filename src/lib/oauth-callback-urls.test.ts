import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  googleAdsOAuthRedirectUri,
  providerOAuthCallbackUri,
} from "./oauth-callback-urls";

const originalNextAuthUrl = process.env.NEXTAUTH_URL;
const originalGoogleAdsRedirectUri = process.env.GOOGLE_ADS_REDIRECT_URI;

after(() => {
  if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalNextAuthUrl;
  if (originalGoogleAdsRedirectUri === undefined) delete process.env.GOOGLE_ADS_REDIRECT_URI;
  else process.env.GOOGLE_ADS_REDIRECT_URI = originalGoogleAdsRedirectUri;
});

describe("Google Ads OAuth callback URI", () => {
  it("uses the unified callback route in both the redirect helper and production config", () => {
    process.env.NEXTAUTH_URL = "https://preview.monsteracloud.com";
    process.env.GOOGLE_ADS_REDIRECT_URI = "https://obsolete.example/api/auth/google-ads/callback";
    const request = new Request("https://request-origin.example/api/integrations/config");
    const expected = "https://preview.monsteracloud.com/api/auth/callback?provider=google_ads";

    assert.equal(googleAdsOAuthRedirectUri(request), expected);
    assert.equal(
      providerOAuthCallbackUri("https://monsteracloud.com", "google_ads"),
      "https://monsteracloud.com/api/auth/callback?provider=google_ads",
    );
  });
});
