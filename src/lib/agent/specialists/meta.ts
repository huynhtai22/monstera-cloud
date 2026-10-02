import { safeDecrypt } from "@/lib/encryption";
import { metaAdsClient } from "@/lib/meta-ads";
import { AgentError } from "../contracts";

/** Always discover with the authorized token; cached IDs alone never grant access. */
export async function discoverMetaAccounts(connection: { credentials: string; status: string; provider: string }) {
  if (connection.status !== "connected" || connection.provider !== "meta_ads") throw new AgentError("reconnect_required", "Reconnect Meta Ads before choosing accounts");
  let token: unknown;
  try { const credentials = JSON.parse(safeDecrypt(connection.credentials)); token = credentials.accessToken ?? credentials.access_token; }
  catch { throw new AgentError("reconnect_required", "Reconnect Meta Ads before choosing accounts"); }
  if (typeof token !== "string" || !token) throw new AgentError("reconnect_required", "Reconnect Meta Ads before choosing accounts");
  try {
    const accounts = await metaAdsClient.getAdAccounts(token);
    return [...new Map(accounts.filter(account => /^act_\d+$/.test(account.id)).map(account => [account.id, { id: account.id, name: account.name || `Meta ad account ${account.id}` }])).values()];
  } catch { throw new AgentError("discovery_failed", "Meta account discovery failed. Try again or reconnect."); }
}
