require('dotenv').config({ path: '.env' });
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
function safeDecrypt(text) {
  if (!text) return null;
  const textParts = text.split(':');
  if (textParts.length !== 2) return null;
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

async function main() {
  const conn = await prisma.connection.findFirst({
    where: { provider: 'google_ads' }
  });
  if (!conn) throw new Error("No connection");
  
  const raw = safeDecrypt(conn.credentials);
  const credentials = JSON.parse(raw);
  
  const customerId = "1208473618"; 
  
  const gaql = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        segments.date
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
  `;
  
  const headers = {
    Authorization: `Bearer ${credentials.accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (credentials.mccId) headers['login-customer-id'] = credentials.mccId.replace(/-/g, '');
  
  const res = await fetch(`https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: gaql })
  });
  
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text.substring(0, 500));
}
main().catch(console.error).finally(() => prisma.$disconnect());
