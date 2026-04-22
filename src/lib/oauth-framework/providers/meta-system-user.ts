/**
 * Meta System User Token Support - Flux Architecture Compliance (Section 3.5)
 *
 * Requirement: For internal marketing automation, use System User tokens
 * instead of standard OAuth to eliminate refresh logic entirely.
 *
 * System User tokens are permanent (until revoked) and bypass expiration.
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";

/**
 * Meta System User configuration
 *
 * These are provisioned through Facebook Business Manager:
 * 1. Create a System User in Business Manager
 * 2. Generate a permanent token with required permissions
 * 3. Store the token (never expires, no refresh needed)
 */
interface SystemUserConfig {
    accessToken: string;
    businessId: string;
    adAccountIds: string[];
    permissions: string[];
}

/**
 * Meta System User Provider Adapter
 *
 * Unlike standard OAuth, this uses a pre-generated permanent token.
 * No authorization URL, no code exchange, no refresh.
 */
export class MetaSystemUserAdapter implements OAuthProviderAdapter {
    readonly id = "meta_ads_system_user";
    readonly name = "Meta Ads (System User)";
    readonly authType = "api_key" as const; // Not OAuth - uses permanent token

    /**
     * System User tokens are configured directly, no OAuth flow
     */
    buildAuthorizeUrl(): string {
        throw new OAuthError(
            "configuration_error",
            "System User tokens do not require OAuth authorization. Configure the token directly in settings.",
            this.id
        );
    }

    /**
     * No code exchange for System User - token is pre-configured
     */
    async exchangeCode(): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        throw new OAuthError(
            "configuration_error",
            "System User tokens are configured directly, not via OAuth exchange.",
            this.id
        );
    }

    /**
     * Create credentials from pre-configured System User token
     */
    createCredentialsFromToken(
        config: SystemUserConfig
    ): { credentials: OAuthCredentials; metadata: ConnectionMetadata } {
        // System User tokens are permanent - set expiresAt far in the future
        const permanentExpiry = new Date("2099-12-31T23:59:59Z");

        const credentials: OAuthCredentials = {
            accessToken: config.accessToken,
            refreshToken: undefined, // No refresh needed
            expiresAt: permanentExpiry,
        };

        const metadata: ConnectionMetadata = {
            name: `Meta System User (${config.businessId})`,
            accountIdentifiers: config.adAccountIds,
            extraFields: {
                businessId: config.businessId,
                permissions: config.permissions,
                tokenType: "system_user",
            },
        };

        return { credentials, metadata };
    }

    validateCredentials(credentials: unknown): boolean {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return false;

        const hasAccessToken =
            typeof creds.accessToken === "string" && creds.accessToken.length > 0;

        // System User tokens don't expire, but we check for the far-future expiry marker
        const isSystemUser =
            creds.expiresAt instanceof Date ||
            (typeof creds.expiresAt === "string" &&
                new Date(creds.expiresAt).getFullYear() > 2050);

        return hasAccessToken && isSystemUser;
    }

    extractAccounts(credentials: unknown): ConnectedAccount[] {
        const creds = credentials as {
            extraFields?: { adAccountIds?: string[]; businessId?: string };
        };

        if (!creds?.extraFields?.adAccountIds) return [];

        return creds.extraFields.adAccountIds.map((id) => ({
            id,
            name: `Ad Account ${id}`,
            type: "ad_account",
        }));
    }

    /**
     * NO-OP: System User tokens never need refresh
     */
    async refreshCredentials(credentials: unknown): Promise<OAuthCredentials> {
        const creds = credentials as { accessToken?: string };

        // Just return the same credentials - System User tokens are permanent
        console.log("[MetaSystemUser] Token is permanent, no refresh needed");

        return {
            accessToken: creds.accessToken || "",
            refreshToken: undefined,
            expiresAt: new Date("2099-12-31T23:59:59Z"),
        };
    }
}

/**
 * Instructions for generating System User token:
 *
 * 1. Go to business.facebook.com
 * 2. Navigate to Business Settings → Users → System Users
 * 3. Add New System User (name: "Monstera Cloud Automation")
 * 4. Assign Assets:
 *    - Select your ad accounts
 *    - Grant "View performance" permission (minimum)
 *    - Or "Manage campaigns" if you need write access
 * 5. Generate Token:
 *    - Click the System User
 *    - "Generate Token"
 *    - Select your app
 *    - Select permissions: ads_read, ads_management (if needed)
 * 6. Copy the token (starts with EAAG...)
 * 7. Store in Monstera Cloud (encrypted in database)
 *
 * Benefits:
 * - Never expires (until manually revoked)
 * - No refresh logic needed
 * - Server-to-server (no user login required)
 * - Bypasses all token expiration issues
 */

/**
 * API to validate a System User token with Meta
 */
export async function validateSystemUserToken(
    accessToken: string
): Promise<{
    valid: boolean;
    businessId?: string;
    adAccountIds?: string[];
    error?: string;
}> {
    try {
        // Call Meta's debug token endpoint
        const appToken = process.env.META_ADS_APP_ID + "|" + process.env.META_ADS_APP_SECRET;

        const response = await fetch(
            `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appToken}`
        );

        const data = await response.json();

        if (data.data?.is_valid) {
            return {
                valid: true,
                businessId: data.data.profile_id, // Business or user ID
                adAccountIds: [], // Would need separate call to get ad accounts
            };
        } else {
            return {
                valid: false,
                error: data.data?.error?.message || "Invalid token",
            };
        }
    } catch (err) {
        return {
            valid: false,
            error: err instanceof Error ? err.message : "Validation failed",
        };
    }
}

/**
 * Settings UI component for System User token input
 * (This would be used in the connection setup modal)
 */
export const SystemUserSetupInstructions = `
## Meta System User Token Setup

For agencies and automation use cases, we recommend using a **System User Token** instead of standard OAuth.

### Advantages:
- ✅ Token never expires (no refresh needed)
- ✅ Server-to-server automation
- ✅ No daily login required
- ✅ More reliable for production syncs

### How to Create:

1. **Go to Business Manager**
   - Visit: business.facebook.com
   - Select your business

2. **Create System User**
   - Business Settings → Users → System Users
   - Click "Add"
   - Name: "Monstera Cloud ETL"
   - Role: Employee

3. **Assign Ad Accounts**
   - Select the ad accounts to sync
   - Grant "View performance" permission

4. **Generate Token**
   - Click the System User
   - Click "Generate Token"
   - Select your Monstera Cloud app
   - Permissions needed: 
     - ads_read (for reporting)
     - ads_management (optional, for campaign edits)

5. **Paste Token**
   - Copy the token (starts with EAAG...)
   - Paste in the field below

**Note:** Keep this token secure. It provides access to your ad data.
`;
