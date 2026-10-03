import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { CertificationHarness } from "./harness";
import { parsePersistedGoogleAdsPortalFacts } from "./portal-access-facts";

const savedAuditEvent = (prisma as any).auditEvent;

after(() => {
  (prisma as any).auditEvent = savedAuditEvent;
});

describe("persisted Google Ads portal facts", () => {
  it("accepts the owner-confirmed facts shape and leaves API version to runtime", () => {
    const parsed = parsePersistedGoogleAdsPortalFacts({
      appAccountMode: "live",
      grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
      accessLevelStatus: "basic",
      authorizationModel: "oauth2_user_consent",
      tokenLifecycleModel: "refreshable_offline",
      verificationSource: "portal_owner_confirmed",
      verifiedAt: "2026-09-27T12:00:00.000Z",
      status: "VERIFIED",
    });
    assert.ok(parsed);
    assert.equal(parsed.verificationSource, "portal_owner_confirmed");
    assert.equal("observedApiVersion" in parsed, false);
  });

  it("rejects unverified, incomplete, and caller-extended records", () => {
    const valid = {
      appAccountMode: "live",
      grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
      accessLevelStatus: "basic",
      authorizationModel: "oauth2_user_consent",
      tokenLifecycleModel: "refreshable_offline",
      verificationSource: "portal_owner_confirmed",
      verifiedAt: "2026-09-27T12:00:00.000Z",
      status: "VERIFIED",
    };
    assert.equal(parsePersistedGoogleAdsPortalFacts({ ...valid, status: "UNVERIFIED" }), null);
    assert.equal(parsePersistedGoogleAdsPortalFacts({ ...valid, grantedScopesOrPermissions: [] }), null);
    assert.equal(parsePersistedGoogleAdsPortalFacts({ ...valid, injected: true }), null);
  });

  it("uses persisted owner facts instead of operator-supplied portal claims", async () => {
    (prisma as any).auditEvent = {
      findFirst: async () => ({
        metadata: {
          provider: "google_ads",
          connectionId: "connection-1",
          verificationSource: "portal_owner_confirmed",
          verifiedAt: "2026-09-27T12:00:00.000Z",
          facts: {
            appAccountMode: "live",
            grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
            accessLevelStatus: "basic",
            authorizationModel: "oauth2_user_consent",
            tokenLifecycleModel: "refreshable_offline",
          },
        },
      }),
    };
    const result = await new CertificationHarness().execute({
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      provider: "google_ads",
      accountId: "123-456-7890",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      buildId: "test-build",
      providerAccessFacts: {
        observedApiVersion: "claimed-version",
        appAccountMode: "development",
        grantedScopesOrPermissions: [],
        accessLevelStatus: "developer",
        authorizationModel: "service_account",
        tokenLifecycleModel: "short_lived_bearer",
        verificationSource: "portal_owner_confirmed",
        verifiedAt: "2026-09-26T00:00:00.000Z",
        status: "VERIFIED",
      },
    });
    assert.equal(result.evidencePack.providerAccessFacts?.observedApiVersion, "v23");
    assert.equal(result.evidencePack.providerAccessFacts?.appAccountMode, "live");
    assert.equal(result.evidencePack.providerAccessFacts?.accessLevelStatus, "basic");
    assert.equal(result.evidencePack.providerAccessFacts?.tokenLifecycleModel, "refreshable_offline");
    assert.deepEqual(result.evidencePack.providerAccessFacts?.grantedScopesOrPermissions, ["https://www.googleapis.com/auth/adwords"]);
  });
});
