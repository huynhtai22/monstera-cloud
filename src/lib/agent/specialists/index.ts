import { discoverTikTokAccounts } from "./tiktok";
import { discoverMetaAccounts } from "./meta";
import { discoverGoogleAccounts } from "./google";
import { discoverShopeeAccounts } from "./shopee";
import { AgentError } from "../contracts";
export const guidedProviders = ["tiktok_business", "meta_ads", "google_ads", "shopee"] as const;
export function discoverProviderAccounts(connection: { credentials: string; status: string; provider: string; remoteAccountId?: string | null }) {
  if (connection.provider === "tiktok_business") return discoverTikTokAccounts(connection);
  if (connection.provider === "meta_ads") return discoverMetaAccounts(connection);
  if (connection.provider === "google_ads") return discoverGoogleAccounts(connection);
  if (connection.provider === "shopee") return discoverShopeeAccounts(connection);
  throw new AgentError("provider_not_available", "Guided setup is unavailable for this provider", 400);
}
