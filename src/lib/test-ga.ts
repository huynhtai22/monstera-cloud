import { googleAdsReportClient } from "./google-ads";
import { getValidOAuthToken } from "./oauth-framework/token-refresh";
import prisma from "./prisma";
import { encrypt, safeDecrypt } from "./encryption";
import { parseConnectionCredentialsJson } from "./parse-connection-credentials";

async function main() {
  const conn = await prisma.connection.findFirst({
    where: { provider: "google_ads", status: "connected" },
  });
  if (!conn) {
    console.log("No connection");
    return;
  }
  
  const raw = safeDecrypt(conn.credentials);
  const credentials = parseConnectionCredentialsJson(raw) as any;
  
  const accessToken = await getValidOAuthToken({
    id: conn.id,
    credentials: encrypt(JSON.stringify(credentials)),
    provider: "google_ads",
  });
  
  const customerIds = credentials.extraFields?.customerIds || credentials.customerIds || [];
  console.log("Customers:", customerIds);
  
  if (customerIds.length === 0) return;
  
  const customerId = customerIds[0];
  console.log("Fetching for:", customerId);
  
  try {
    const rows = await googleAdsReportClient.getCampaignPerformance(
      accessToken,
      customerId,
      "BETWEEN '2026-04-01' AND '2026-05-09'",
      credentials.mccId
    );
    console.log("Rows returned:", rows.length);
    if (rows.length > 0) {
      console.log("Row 0:", JSON.stringify(rows[0], null, 2));
      
      // Let's test the transformation logic in sync-connection
      const r = rows[0] as any;
      const transformed = {
          campaign_id: String(r.campaign_id || r.campaign_name || ''),
          campaign_name: r.campaign_name,
          ad_group_id: r.ad_group_id,
          ad_group_name: r.ad_group_name,
          date: r.segments_date || r.date,
          impressions: r.metrics_impressions || r.impressions,
          clicks: r.metrics_clicks || r.clicks,
          cost: r.metrics_cost || r.cost,
          cpc: r.metrics_average_cpc || r.average_cpc,
          ctr: r.metrics_ctr || r.ctr,
          conversions: r.metrics_conversions || r.conversions,
          conversion_value: r.metrics_conversion_value || r.conversion_value,
          currency: r.customer_currency_code || r.currency,
          raw: r,
      };
      console.log("Transformed:", JSON.stringify(transformed, null, 2));
    }
  } catch (e) {
    console.error(e);
  }
}

main().catch(console.error);
