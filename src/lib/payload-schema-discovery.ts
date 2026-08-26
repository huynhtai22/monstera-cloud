import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type DiscoveredField = { name: string; type: string };

export function fieldTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object") return "object";
  if (t === "number") return Number.isInteger(value) ? "integer" : "number";
  return t;
}

/** Key names and types only — never values. */
export function describePayloadFields(sample: unknown, prefix = ""): DiscoveredField[] {
  if (sample === null || sample === undefined) return [];
  if (typeof sample !== "object") {
    return prefix ? [{ name: prefix, type: fieldTypeOf(sample) }] : [];
  }
  if (Array.isArray(sample)) {
    return prefix ? [{ name: prefix, type: "array" }] : describePayloadFields(sample[0] ?? {}, prefix);
  }
  const fields: DiscoveredField[] = [];
  for (const [key, value] of Object.entries(sample as Record<string, unknown>)) {
    const name = prefix ? `${prefix}.${key}` : key;
    fields.push({ name, type: fieldTypeOf(value) });
  }
  return fields.sort((a, b) => a.name.localeCompare(b.name));
}

export function hashPayloadSchema(fields: DiscoveredField[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export async function recordPayloadSchemaDiscovery(opts: {
  workspaceId: string;
  connectionId: string;
  provider: string;
  sample: unknown;
}): Promise<void> {
  try {
    const fields = describePayloadFields(opts.sample);
    if (fields.length === 0) return;
    const schemaHash = hashPayloadSchema(fields);
    await prisma.payloadSchemaDiscovery.upsert({
      where: {
        connectionId_schemaHash: {
          connectionId: opts.connectionId,
          schemaHash,
        },
      },
      create: {
        workspaceId: opts.workspaceId,
        connectionId: opts.connectionId,
        provider: opts.provider,
        schemaHash,
        fields: JSON.stringify(fields),
      },
      update: { discoveredAt: new Date() },
    });
  } catch (error) {
    logger.warn("[payload-schema-discovery] skipped", error instanceof Error ? error.message : error);
  }
}
