import { getConnectorConfig, isConnectorSupported } from "@/etl/connector-registry";
import type { DiscoveredField } from "@/lib/payload-schema-discovery";

export type MappingProposalDraft = {
  provider: string;
  addedFields: string[];
  removedFields: string[];
  mappingDelta: Record<string, string>;
  breaking: boolean;
  note: string;
};

export const CANONICAL_WAREHOUSE_FIELDS = new Set([
  "campaignId",
  "campaignName",
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "revenue",
  "currency",
]);

function leafName(path: string): string {
  return path.split(".").pop() ?? path;
}

function guessCanonical(sourceField: string): string | null {
  const leaf = leafName(sourceField).replace(/-/g, "_");
  const lower = leaf.toLowerCase();
  if (lower === "campaign_id" || lower === "campaignid") return "campaignId";
  if (lower === "campaign_name" || lower === "campaignname") return "campaignName";
  if (lower === "spend" || lower === "cost") return "spend";
  if (lower === "impressions") return "impressions";
  if (lower === "clicks") return "clicks";
  if (lower === "conversions") return "conversions";
  if (lower === "conversion_value" || lower === "revenue" || lower === "total_amount") return "revenue";
  if (lower === "currency") return "currency";
  return CANONICAL_WAREHOUSE_FIELDS.has(leaf) ? leaf : null;
}

export function draftMappingProposal(provider: string, fields: DiscoveredField[]): MappingProposalDraft | null {
  if (!isConnectorSupported(provider)) return null;
  const config = getConnectorConfig(provider);
  if (!config) return null;

  const mapped = new Set(Object.keys(config.fieldMapping));
  const discovered = new Set(fields.map((f) => f.name));
  const addedFields = [...discovered].filter((name) => !mapped.has(name) && !mapped.has(leafName(name)));
  const removedFields = [...mapped].filter((name) => !discovered.has(name) && !discovered.has(leafName(name)));
  const mappingDelta: Record<string, string> = {};
  for (const name of addedFields) {
    const canonical = guessCanonical(name);
    if (canonical) mappingDelta[name] = canonical;
  }
  const requiredMissing = config.requiredFields.filter((name) => !discovered.has(name) && !discovered.has(leafName(name)));
  const breaking = requiredMissing.length > 0;
  if (addedFields.length === 0 && removedFields.length === 0) return null;

  return {
    provider,
    addedFields,
    removedFields,
    mappingDelta,
    breaking,
    note: breaking
      ? `Required fields missing: ${requiredMissing.join(", ")}. Engineer PR against compile-time fieldMapping. OPERATOR cannot overlay breaking diffs.`
      : "Additive canonical keys only. OPERATOR approve applies a per-connection overlay; compile-time fieldMapping is unchanged.",
  };
}
