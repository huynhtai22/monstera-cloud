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

function fmt(level: string, msg: string): string {
  return `[${level}] ${msg}`;
}

export const logger = {
  info(msg: string, ctx?: object) {
    if (!isDev) return; // suppress in prod — use warn/error for signals
    console.log(fmt("INFO", msg), ...(ctx ? [ctx] : []));
  },
  warn(msg: string, ctx?: object) {
    console.warn(fmt("WARN", msg), ...(ctx ? [ctx] : []));
  },
  error(msg: string, ctx?: object) {
    console.error(fmt("ERROR", msg), ...(ctx ? [ctx] : []));
  },
};
