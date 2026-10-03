import { safeDecrypt } from "@/lib/encryption";
import { shopeeDataClient } from "@/lib/shopee";
import { normalizeStoredShopeeCreds } from "@/lib/shopee-credential-utils";
import { AgentError } from "../contracts";

/** Signed shop lookup verifies token access to the exact persisted shop. */
export async function discoverShopeeAccounts(connection: { credentials: string; status: string; provider: string; remoteAccountId?: string | null }) {
  if (connection.status !== "connected" || connection.provider !== "shopee") throw new AgentError("reconnect_required", "Reconnect Shopee before choosing a shop");
  try {
    const credentials = normalizeStoredShopeeCreds(JSON.parse(safeDecrypt(connection.credentials)));
    if (!credentials.access_token || !Number.isSafeInteger(credentials.shop_id) || credentials.shop_id <= 0 || String(credentials.shop_id) !== connection.remoteAccountId) throw new Error("Shop binding mismatch");
    const shop = await shopeeDataClient.getShopInfo({ accessToken: credentials.access_token, shopId: credentials.shop_id, sandbox: credentials.sandbox === true });
    if (shop.status.toUpperCase() !== "NORMAL") throw new Error("Shop unavailable");
    return [{ id: String(credentials.shop_id), name: shop.shop_name }];
  } catch { throw new AgentError("reconnect_required", "Shopee shop access could not be verified. Reconnect the shop and try again."); }
}
