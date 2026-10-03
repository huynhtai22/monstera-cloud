import { safeDecrypt } from "@/lib/encryption";
import { googleAdsOAuthClient, googleAdsReportClient } from "@/lib/google-ads";
import { AgentError } from "../contracts";

/** Resolve live leaves under this persisted root; cached child IDs do not grant access. */
export async function discoverGoogleAccounts(connection: { credentials: string; status: string; provider: string; remoteAccountId?: string | null }) {
  if (connection.status !== "connected" || connection.provider !== "google_ads") throw new AgentError("reconnect_required", "Reconnect Google Ads before choosing accounts");
  try {
    const credentials = JSON.parse(safeDecrypt(connection.credentials));
    const root = connection.remoteAccountId?.replace(/-/g, "");
    if (!root || !/^\d+$/.test(root) || !credentials.accessToken) throw new Error("Missing authorized root");
    let token = credentials.accessToken;
    if (credentials.expiresAt && new Date(credentials.expiresAt).getTime() <= Date.now() + 60_000) {
      if (!credentials.refreshToken) throw new Error("Missing refresh permission");
      // Google refresh tokens remain stable. The shared worker persists its own refresh.
      token = (await googleAdsOAuthClient.refreshAccessToken(credentials.refreshToken)).access_token;
    }
    const clients = await googleAdsReportClient.listCustomerClients(token, root);
    return [...new Map(clients.filter(client => !client.isManager && /^\d+$/.test(client.customerId) && client.mccId === root).map(client => [client.customerId, { id: client.customerId, name: client.descriptiveName || `Customer ${client.customerId}` }])).values()];
  } catch { throw new AgentError("discovery_failed", "Google account discovery failed. Check source access or reconnect."); }
}
