/**
 * Synthetic Test Environment Setup
 *
 * Configures dummy environment variables needed by connector client constructors
 * during unit / simulation test runs.
 */

export function setupSyntheticTestEnv(): void {
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "synthetic-dev-token";
  process.env.GOOGLE_ADS_CLIENT_ID = "synthetic-google-client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "synthetic-google-client-secret";
  process.env.META_ADS_APP_ID = "synthetic-meta-app-id";
  process.env.META_ADS_APP_SECRET = "synthetic-meta-app-secret";
  process.env.TIKTOK_BUSINESS_APP_ID = "synthetic-tiktok-app-id";
  process.env.TIKTOK_BUSINESS_APP_SECRET = "synthetic-tiktok-app-secret";
}
