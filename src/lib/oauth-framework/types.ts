/**
 * OAuth Framework - Provider Adapter Interface
 * Unified abstraction for all source OAuth flows
 */
/** Standardized connected account representation */
export interface ConnectedAccount {
    id: string;
    name: string;
    type: "ad-account" | "shop" | "seller-center" | "advertiser" | "customer";
}

/** OAuth credentials as returned from provider exchange */
export interface OAuthCredentials {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    [key: string]: unknown; // Provider-specific extras
}

/** Provider-specific metadata for connection creation */
export interface ConnectionMetadata {
    name: string;
    accountIdentifiers: string[]; // IDs to show in UI
    extraFields?: Record<string, unknown>; // Provider-specific data
}

/** OAuth Provider Adapter Interface
 * 
 * Each source (Shopee, Meta, TikTok, etc.) implements this interface.
 * The framework handles the common flow; providers handle specifics.
 */
export interface OAuthProviderAdapter {
    /** Unique provider ID */
    readonly id: string;
    
    /** Display name */
    readonly name: string;
    
    /** Authorization type */
    readonly authType: "oauth" | "oauth-popup" | "api-key";
    
    /** Build the authorization URL */
    buildAuthorizeUrl(params: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string | Promise<string>;
    
    /** Exchange authorization code for tokens */
    exchangeCode(params: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }>;
    
    /** Validate stored credentials are still usable */
    validateCredentials(credentials: unknown): boolean;
    
    /** Extract displayable accounts from stored credentials */
    extractAccounts(credentials: unknown): ConnectedAccount[];
    
    /** Refresh access token if expired */
    refreshCredentials?(credentials: unknown): Promise<OAuthCredentials>;
}

/** Registry of all OAuth providers */
export type OAuthProviderRegistry = Record<string, OAuthProviderAdapter>;

/** OAuth error types for consistent handling */
export type OAuthErrorCode = 
    | "unauthorized" 
    | "invalid_state" 
    | "code_exchange_failed"
    | "provider_error"
    | "user_denied"
    | "configuration_error"
    | "unknown";

export class OAuthError extends Error {
    constructor(
        public code: OAuthErrorCode,
        message: string,
        public provider?: string,
        public retryable = false
    ) {
        super(message);
        this.name = "OAuthError";
    }
}

/** Session validation result */
export interface SessionContext {
    userId: string;
    workspaceId: string;
    email?: string | null;
}
