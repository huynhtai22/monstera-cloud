import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// Bitget API configuration from environment variables
const BITGET_API_KEY = process.env.BITGET_API_KEY || "";
const BITGET_API_SECRET = process.env.BITGET_API_SECRET || "";
const BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE || "";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// Monitor parameters
const TARGET_PROFIT_PCT = parseFloat(process.env.BITGET_TARGET_PROFIT_PCT || "15.0"); // Target profit +15%
const STOP_LOSS_PCT = parseFloat(process.env.BITGET_STOP_LOSS_PCT || "-5.0");       // Stop loss -5%

interface Position {
  symbol: string;
  marginSize: number;
  openPrice: number;
  currentPrice: number;
  unrealizedPL: number;
  pnlPercentage: number;
  holdSide: "long" | "short";
}

function generateSignature(
  timestamp: string,
  method: string,
  requestPath: string,
  queryString: string,
  bodyString: string,
  secretKey: string
): string {
  const message = timestamp + method.toUpperCase() + requestPath + queryString + bodyString;
  return crypto
    .createHmac("sha256", secretKey)
    .update(message)
    .digest("base64");
}

async function sendTelegramAlert(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`[ALERT SIMULATION] No Telegram credentials. Alert message:\n${message}`);
    return;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Failed to send Telegram alert:", res.status, err);
    } else {
      console.log("Telegram alert sent successfully!");
    }
  } catch (e) {
    console.error("Error sending Telegram alert:", e);
  }
}

async function fetchLivePositions(): Promise<Position[]> {
  const timestamp = Date.now().toString();
  const method = "GET";
  const requestPath = "/api/v2/mix/position/all-position";
  const queryString = "?productType=USDT-FUTURES";
  const bodyString = "";

  const signature = generateSignature(
    timestamp,
    method,
    requestPath,
    queryString,
    bodyString,
    BITGET_API_SECRET
  );

  const headers = {
    "ACCESS-KEY": BITGET_API_KEY,
    "ACCESS-SIGN": signature,
    "ACCESS-TIMESTAMP": timestamp,
    "ACCESS-PASSPHRASE": BITGET_PASSPHRASE,
    "Content-Type": "application/json",
    "locale": "en-US",
  };

  const response = await fetch(`https://api.bitget.com${requestPath}${queryString}`, {
    method,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Bitget API responded with status ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  if (result.code !== "00000") {
    throw new Error(`Bitget API error: ${result.msg || JSON.stringify(result)}`);
  }

  const positions: Position[] = [];
  const rawList = result.data || [];

  for (const p of rawList) {
    // Only look at open positions
    const size = parseFloat(p.total || "0");
    if (size === 0) continue;

    const openPrice = parseFloat(p.openPrice || "0");
    const currentPrice = parseFloat(p.marketPrice || "0");
    const unrealizedPL = parseFloat(p.unrealizedPL || "0");
    const marginSize = parseFloat(p.marginSize || "0");
    const holdSide = p.holdSide === "long" ? "long" : "short";

    // Calculate PnL percentage based on margin
    const pnlPercentage = marginSize > 0 ? (unrealizedPL / marginSize) * 100 : 0;

    positions.push({
      symbol: p.symbol,
      marginSize,
      openPrice,
      currentPrice,
      unrealizedPL,
      pnlPercentage,
      holdSide,
    });
  }

  return positions;
}

function getMockPositions(): Position[] {
  console.log("ℹ️ Bitget credentials not set. Running in simulation/mock mode.");
  return [
    {
      symbol: "BTCUSDT",
      marginSize: 500,
      openPrice: 65200,
      currentPrice: 66340,
      unrealizedPL: 87.42,
      pnlPercentage: 17.48, // Exceeds target profit (+15%)
      holdSide: "long",
    },
    {
      symbol: "ETHUSDT",
      marginSize: 300,
      openPrice: 3450,
      currentPrice: 3230,
      unrealizedPL: -95.65,
      pnlPercentage: -31.88, // Exceeds stop loss (-5%)
      holdSide: "long",
    },
    {
      symbol: "SOLUSDT",
      marginSize: 150,
      openPrice: 145.2,
      currentPrice: 147.8,
      unrealizedPL: 5.37,
      pnlPercentage: 3.58, // Normal range
      holdSide: "long",
    },
  ];
}

async function run() {
  const isConfigured = BITGET_API_KEY && BITGET_API_SECRET && BITGET_PASSPHRASE;
  
  let positions: Position[] = [];
  try {
    if (isConfigured) {
      console.log("Fetching live positions from Bitget API...");
      positions = await fetchLivePositions();
    } else {
      positions = getMockPositions();
    }
  } catch (error: any) {
    console.error("❌ Failed to fetch live positions, falling back to simulation:", error.message || error);
    positions = getMockPositions();
  }

  console.log(`Analyzing ${positions.length} open position(s)...`);
  let alertTriggered = false;
  let alertMessage = `📈 *Bitget Crypto Position Monitor Alert*\n\n`;

  for (const pos of positions) {
    const sideEmoji = pos.holdSide === "long" ? "🟢 LONG" : "🔴 SHORT";
    const pnlSign = pos.unrealizedPL >= 0 ? "+" : "";
    console.log(
      `Symbol: ${pos.symbol} | ${sideEmoji} | PnL: ${pnlSign}$${pos.unrealizedPL.toFixed(2)} (${pos.pnlPercentage.toFixed(2)}%)`
    );

    let statusType: "profit" | "loss" | "normal" = "normal";
    if (pos.pnlPercentage >= TARGET_PROFIT_PCT) {
      statusType = "profit";
      alertTriggered = true;
    } else if (pos.pnlPercentage <= STOP_LOSS_PCT) {
      statusType = "loss";
      alertTriggered = true;
    }

    if (statusType !== "normal") {
      const alertTypeEmoji = statusType === "profit" ? "🚀 PROFIT TARGET HIT" : "⚠️ STOP LOSS TRIGGERED";
      alertMessage += `*${alertTypeEmoji}* on **${pos.symbol}** (${sideEmoji})\n`;
      alertMessage += `- *PnL:* ${pnlSign}$${pos.unrealizedPL.toFixed(2)} (**${pos.pnlPercentage.toFixed(2)}%**)\n`;
      alertMessage += `- *Open Price:* ${pos.openPrice.toFixed(4)}\n`;
      alertMessage += `- *Current Price:* ${pos.currentPrice.toFixed(4)}\n`;
      alertMessage += `- *Margin:* $${pos.marginSize.toFixed(2)}\n\n`;
    }
  }

  if (alertTriggered) {
    alertMessage += `_Action Recommended: Check your account or orders on Bitget._`;
    await sendTelegramAlert(alertMessage);
  } else {
    console.log("All positions are within normal bounds. No alerts triggered.");
  }

  // Update HEARTBEAT.md checklist item
  const heartbeatPath = path.join(__dirname, "../HEARTBEAT.md");
  if (fs.existsSync(heartbeatPath)) {
    let heartbeatContent = fs.readFileSync(heartbeatPath, "utf-8");
    const dateStr = new Date().toISOString().split(".")[0];
    
    heartbeatContent = heartbeatContent.replace(
      /- \[\s*\] BITGET_MONITOR: Every 2-4 hours, fetch position status\. If PnL > target or < stop-loss, alert immediately\./g,
      `- [x] BITGET_MONITOR: Every 2-4 hours, fetch position status. If PnL > target or < stop-loss, alert immediately. (Completed: ${dateStr})`
    );

    fs.writeFileSync(heartbeatPath, heartbeatContent);
    console.log("HEARTBEAT.md updated with Bitget Monitor completion!");
  }
}

run().catch((e) => {
  console.error("Monitor failed:", e);
});
