import { safeDecrypt } from "@/lib/encryption";
import { tiktokBusinessClient } from "@/lib/tiktok-business";
import { AgentError } from "../contracts";

/** Credentials stay inside the adapter. A remote identity is not proof of access. */
export async function discoverTikTokAccounts(connection: { credentials: string; status: string; provider: string }) {
  if (connection.status !== "connected" || connection.provider !== "tiktok_business") {
    throw new AgentError("reconnect_required", "Reconnect TikTok before choosing accounts");
  }
  let token: unknown;
  try { const credentials = JSON.parse(safeDecrypt(connection.credentials)); token = credentials.accessToken ?? credentials.access_token; }
  catch { throw new AgentError("reconnect_required", "Reconnect TikTok before choosing accounts"); }
  if (typeof token !== "string" || !token) throw new AgentError("reconnect_required", "Reconnect TikTok before choosing accounts");
  try {
    const result = await tiktokBusinessClient.listAuthorizedAdvertisers(token);
    return [...new Set(result.advertiser_ids.map(String))].filter(id => /^\d+$/.test(id)).map(id => ({ id, name: `TikTok advertiser ${id}` }));
  } catch {
    throw new AgentError("discovery_failed", "TikTok account discovery failed. Try again or reconnect.");
  }
}
