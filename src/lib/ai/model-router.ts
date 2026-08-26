export type ModelTask =
  | "classify_intent"
  | "tool_call"
  | "narrative"
  | "schema_patch"
  | "eval_judge";

export function routeModel(task: ModelTask): {
  provider: "openai" | "anthropic" | "xai" | "deterministic";
  model: string;
  maxTokens: number;
} {
  switch (task) {
    case "classify_intent":
      return { provider: "deterministic", model: "classifyQuestion", maxTokens: 0 };
    case "eval_judge":
      return { provider: "deterministic", model: "eval_fixtures", maxTokens: 0 };
    case "tool_call":
      return {
        provider: "openai",
        model: process.env.AI_SUMMARY_MODEL?.trim() || "gpt-4o-mini",
        maxTokens: 800,
      };
    case "narrative":
      return {
        provider: "xai",
        model: process.env.AI_NARRATIVE_MODEL?.trim() || "grok-4.6",
        maxTokens: 600,
      };
    case "schema_patch":
      return { provider: "deterministic", model: "draftMappingProposal", maxTokens: 0 };
  }
}
