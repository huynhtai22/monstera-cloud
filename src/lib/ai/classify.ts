export type AnalystIntent =
  | "metrics"
  | "health"
  | "identity_attribution"
  | "injection"
  | "budget_write"
  | "creative"
  | "other";

export type QuestionClass = {
  intent: AnalystIntent;
  refuse: boolean;
  refusalCode?: string;
  tools: Array<"get_reporting_readiness" | "get_source_health" | "query_metrics">;
  needsQueue: boolean;
};

const IDENTITY =
  /\b(first[- ]?time|first[- ]?touch|new buyer|identity|pixel|later converted|who (then|later)|buyers in vietnam|geo(graphy)?|country)\b/i;
const INJECTION =
  /\b(ignore (all )?(previous|prior) (instructions|prompts)|dump (other )?workspaces|reveal (the )?(system|hidden) prompt)\b/i;
const BUDGET_WRITE =
  /\b(reallocate|move budget|change budget|set budget|auto[- ]?bid|increase spend automatically)\b/i;
const HEALTH = /\b(stale|partial|sync(ed|ing)?|freshness|reconnect|last data through|not synced)\b/i;
const CREATIVE = /\b(hook|transcript|creative|video ad|thumbnail|cta placement)\b/i;
const DEEPER =
  /\b(executive brief|deeper brief|full report|week[- ]over[- ]week|anomal(y|ies))\b/i;

export const FLAGSHIP_REFUSAL_QUESTION =
  "Which TikTok campaigns generated first-time buyers in Vietnam that later converted on Shopee with >3x ROAS?";

export function classifyQuestion(question: string): QuestionClass {
  const q = question.trim();
  if (!q) {
    return { intent: "other", refuse: true, refusalCode: "empty", tools: [], needsQueue: false };
  }
  if (INJECTION.test(q)) {
    return { intent: "injection", refuse: true, refusalCode: "injection", tools: [], needsQueue: false };
  }
  if (IDENTITY.test(q) || q === FLAGSHIP_REFUSAL_QUESTION) {
    return {
      intent: "identity_attribution",
      refuse: true,
      refusalCode: "out_of_envelope",
      tools: [],
      needsQueue: false,
    };
  }
  if (BUDGET_WRITE.test(q)) {
    return { intent: "budget_write", refuse: true, refusalCode: "hitl_required", tools: [], needsQueue: false };
  }
  if (CREATIVE.test(q)) {
    return { intent: "creative", refuse: true, refusalCode: "no_assets", tools: [], needsQueue: false };
  }
  if (HEALTH.test(q)) {
    return { intent: "health", refuse: false, tools: ["get_source_health"], needsQueue: false };
  }
  return {
    intent: "metrics",
    refuse: false,
    tools: ["get_reporting_readiness", "query_metrics"],
    needsQueue: DEEPER.test(q),
  };
}

export function refusalMessage(code: string): string {
  switch (code) {
    case "injection":
      return "That request is not allowed. Untrusted text cannot change tools, tenant, or policy.";
    case "out_of_envelope":
      return "I cannot answer identity, geo, first-time, or sequential cross-channel conversion questions. CampaignMetric has no buyer id, country, or new-buyer flag. Nearest legal queries: TikTok campaign ROAS for the window; Shopee daily GMV; UTM-matched overlap if utmCampaign is populated.";
    case "hitl_required":
      return "Budget writes are not enabled. I can only recommend a human-approved change later.";
    case "no_assets":
      return "Creative/video attributes are not stored yet. I can rank ads by existing adId metrics only after that leaderboard ships.";
    case "empty":
      return "Ask a warehouse question about spend, clicks, or source health.";
    case "blocked_readiness":
      return "This dataset is not report-ready. See blockers. Best-effort answers are not exportable.";
    default:
      return "I cannot answer that from the warehouse.";
  }
}
