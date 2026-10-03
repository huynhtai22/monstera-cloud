import { routeModel } from "@/lib/ai/model-router";
import { AgentError, MessageSchema } from "./contracts";
import type { AgentScope } from "./contracts";
import { ONBOARDING_PROVIDERS } from "./catalog";
import { agentTransaction, appendAgentEvent } from "./events";
import { assertRunWritable, requireAgentRun } from "./scope";
import { eligibleProviders, ProposalSchema } from "./tools";

const ALIASES = {
  tiktok_business: /\btik\s?tok(?:\s+ads)?\b/i,
  meta_ads: /\b(meta(?:\s+ads)?|facebook|instagram)\b/i,
  google_ads: /\b(google\s+ads|adwords)\b/i,
  shopee: /\bshopee\b/i,
} as const;

/** Conservative fallback: questions/negative/unsupported requests never act. */
export function interpretConnectorRequest(text: string, allowed: readonly string[]) {
  const uncertain = /\?|\b(how|what|which|why|maybe|perhaps|not|don't|do not|except|without|instead|remove|disconnect|cancel|ignore|all|everything)\b/i.test(text);
  const found = ONBOARDING_PROVIDERS.filter(p => ALIASES[p.id].test(text));
  const unsupported = /\b(shopify|lazada|amazon|sheets|tiktok\s+shop)\b/i.test(text);
  const providerIds = !uncertain && !unsupported ? found.filter(p => allowed.includes(p.id)).map(p => p.id) : [];
  const unavailable = found.some(p => !allowed.includes(p.id));
  return { providerIds, unavailable, ambiguous: uncertain || unsupported || !found.length };
}

/** One interpretation step, zero external calls/cost with the existing router.
 * Message + bounded reply + events commit together, including duplicate replay.
 */
export async function coordinateMessage(scope: AgentScope, runId: string, input: unknown) {
  const parsed = MessageSchema.parse(input);
  const routing = routeModel("classify_intent");
  return agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId, true);
    const existing = await tx.agentRunMessage.findFirst({ where: { workspaceId: scope.workspaceId, runId, messageKey: parsed.messageId } });
    if (existing) {
      if (existing.content !== parsed.text || existing.role !== "user") throw new AgentError("idempotency_conflict", "Message identifier was already used for different content");
      const reply = await tx.agentRunMessage.findFirst({ where: { workspaceId: scope.workspaceId, runId, messageKey: `${parsed.messageId}:reply` } });
      return { message: existing, reply, lastSequence: run.lastEventSequence };
    }
    assertRunWritable(run.status);
    if (run.version !== parsed.expectedVersion) throw new AgentError("stale_version", "Setup changed; refresh before retrying", 409, run.version);
    const allowed = await eligibleProviders(tx, scope.workspaceId);
    const interpreted = interpretConnectorRequest(parsed.text, allowed);
    const proposedActions = interpreted.providerIds.length ? [ProposalSchema.parse({ tool: "select_providers", providerIds: interpreted.providerIds })] : [];
    const names = ONBOARDING_PROVIDERS.filter(p => interpreted.providerIds.includes(p.id)).map(p => p.name).join(" and ");
    const content = names ? `I can prepare ${names} agents. Add them below, then authorize each account when connection setup is available.${interpreted.unavailable ? " Another source you mentioned isn’t enabled for this workspace." : ""}`
      : interpreted.unavailable ? "That source isn’t enabled for this workspace. Choose an available source below, or ask your workspace owner for access."
      : "Which advertising or shop source would you like to start with? Choose a source below, or say, for example, ‘TikTok Ads and Meta Ads’. Account authorization always stays with you.";
    const message = await tx.agentRunMessage.create({ data: { workspaceId: scope.workspaceId, runId, messageKey: parsed.messageId, role: "user", content: parsed.text } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId, type: "message_added", payload: { messageId: message.id } });
    const reply = await tx.agentRunMessage.create({ data: { workspaceId: scope.workspaceId, runId, messageKey: `${parsed.messageId}:reply`, role: "assistant", content,
      structuredResponse: { proposedActions, interpreter: routing.provider === "deterministic" ? routing.model : "bounded_connector_fallback", planningSteps: 1, costUsd: 0 } } });
    const event = await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId, type: "message_added", payload: { messageId: reply.id } });
    return { message, reply, lastSequence: event.sequence };
  });
}
