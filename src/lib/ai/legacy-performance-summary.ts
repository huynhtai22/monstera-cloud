/** Ungoverned 7-day summary is retired in production regardless of ENABLE_AI_SUMMARIES. */
export function isLegacyPerformanceSummaryRetired(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}
