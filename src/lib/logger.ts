/**
 * Structured Logger — server-side only.
 *
 * - In development  : logs everything to console (same dev experience)
 * - In production   : suppresses info, keeps warn + error so Vercel logs
 *                     stay clean without losing alerts
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("[SHOPEE] token refreshed", { shopId });
 *   logger.warn("[AUTH] session missing");
 *   logger.error("[PIPELINE] sync failed", { error: e.message });
 */

const isDev = process.env.NODE_ENV === "development";

export const logger = {
  info(msg: any, ...args: any[]) {
    if (!isDev) return; // suppress in prod — use warn/error for signals
    if (typeof msg === "string") console.log(`[INFO] ${msg}`, ...args);
    else console.log("[INFO]", msg, ...args);
  },
  warn(msg: any, ...args: any[]) {
    if (typeof msg === "string") console.warn(`[WARN] ${msg}`, ...args);
    else console.warn("[WARN]", msg, ...args);
  },
  error(msg: any, ...args: any[]) {
    if (typeof msg === "string") console.error(`[ERROR] ${msg}`, ...args);
    else console.error("[ERROR]", msg, ...args);
  },
};
