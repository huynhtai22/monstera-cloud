/**
 * OBSERVABILITY: Schema Version Tracking
 * Detect and handle API schema changes gracefully
 */

import prisma from "@/lib/prisma";
import crypto from "crypto";
import { logger } from "@/lib/logger";

interface DiscoveredField {
  name: string;
  type: string;
  nullable: boolean;
  description?: string;
}

interface SchemaDiscovery {
  fields: DiscoveredField[];
  primaryKeys: string[];
  version: string;
}

/**
 * Generate hash for schema content
 */
function hashSchema(fields: DiscoveredField[]): string {
  const content = JSON.stringify(
    fields.map((f) => ({ n: f.name, t: f.type, nul: f.nullable }))
  );
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Record discovered schema for a connection
 */
export async function recordSchemaVersion(
  connectionId: string,
  provider: string,
  discovery: SchemaDiscovery
): Promise<{
  schemaId: string;
  isNew: boolean;
  hasChanges: boolean;
  breakingChanges: number;
}> {
  const schemaHash = hashSchema(discovery.fields);

  // Check if this exact schema already exists
  const existing = await prisma.schemaVersion.findUnique({
    where: {
      connectionId_version: {
        connectionId,
        version: discovery.version,
      },
    },
  });

  if (existing && existing.schemaHash === schemaHash) {
    // No changes
    return {
      schemaId: existing.id,
      isNew: false,
      hasChanges: false,
      breakingChanges: 0,
    };
  }

  // Check for breaking changes
  const previousSchema = await prisma.schemaVersion.findFirst({
    where: {
      connectionId,
      isActive: true,
    },
    orderBy: { discoveredAt: "desc" },
  });

  let breakingChanges = 0;

  if (previousSchema) {
    const previousFields: DiscoveredField[] = JSON.parse(previousSchema.fields);
    breakingChanges = detectBreakingChanges(previousFields, discovery.fields);

    // Mark old schema as deprecated if breaking changes detected
    if (breakingChanges > 0) {
      await prisma.schemaVersion.update({
        where: { id: previousSchema.id },
        data: {
          isActive: false,
          deprecatedAt: new Date(),
        },
      });
    }
  }

  // Create new schema record
  const newSchema = await prisma.schemaVersion.create({
    data: {
      connectionId,
      provider,
      version: discovery.version,
      schemaHash,
      fields: JSON.stringify(discovery.fields),
      primaryKeys: JSON.stringify(discovery.primaryKeys),
      breakingChanges,
      isActive: true,
    },
  });

  return {
    schemaId: newSchema.id,
    isNew: true,
    hasChanges: true,
    breakingChanges,
  };
}

/**
 * Detect breaking changes between schema versions
 */
function detectBreakingChanges(
  previous: DiscoveredField[],
  current: DiscoveredField[]
): number {
  let breaking = 0;

  const previousMap = new Map(previous.map((f) => [f.name, f]));
  const currentMap = new Map(current.map((f) => [f.name, f]));

  // Check for removed required fields
  for (const prevField of previous) {
    const currentField = currentMap.get(prevField.name);
    if (!currentField && !prevField.nullable) {
      // Required field removed
      breaking++;
    }
  }

  // Check for type changes on existing fields
  for (const currField of current) {
    const prevField = previousMap.get(currField.name);
    if (prevField && prevField.type !== currField.type) {
      // Type changed
      breaking++;
    }
  }

  return breaking;
}

/**
 * Get active schema for a connection
 */
export async function getActiveSchema(
  connectionId: string
): Promise<SchemaDiscovery | null> {
  const schema = await prisma.schemaVersion.findFirst({
    where: {
      connectionId,
      isActive: true,
    },
    orderBy: { discoveredAt: "desc" },
  });

  if (!schema) return null;

  return {
    fields: JSON.parse(schema.fields),
    primaryKeys: JSON.parse(schema.primaryKeys || "[]"),
    version: schema.version,
  };
}

/**
 * Get schema change history
 */
export async function getSchemaHistory(
  connectionId: string
): Promise<
  Array<{
    version: string;
    discoveredAt: Date;
    breakingChanges: number;
    isActive: boolean;
    deprecatedAt?: Date;
  }>
> {
  const schemas = await prisma.schemaVersion.findMany({
    where: { connectionId },
    orderBy: { discoveredAt: "desc" },
    select: {
      version: true,
      discoveredAt: true,
      breakingChanges: true,
      isActive: true,
      deprecatedAt: true,
    },
  });

  return schemas.map((s) => ({
    version: s.version,
    discoveredAt: s.discoveredAt,
    breakingChanges: s.breakingChanges,
    isActive: s.isActive,
    deprecatedAt: s.deprecatedAt ?? undefined,
  }));
}

/**
 * Discover schema from API response sample
 */
export function discoverSchemaFromSample(
  sampleData: any[],
  provider: string
): SchemaDiscovery {
  if (!sampleData || sampleData.length === 0) {
    return { fields: [], primaryKeys: [], version: "unknown" };
  }

  // Infer fields from first record
  const firstRecord = sampleData[0];
  const fields: DiscoveredField[] = [];

  for (const [key, value] of Object.entries(firstRecord)) {
    fields.push({
      name: key,
      type: inferType(value),
      nullable: value === null || value === undefined,
    });
  }

  // Detect primary keys
  const primaryKeys = detectPrimaryKeys(fields, provider);

  return {
    fields,
    primaryKeys,
    version: `${provider}_discovered_${Date.now()}`,
  };
}

/**
 * Infer data type from value
 */
function inferType(value: any): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "string") {
    // Check for date patterns
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "datetime";
    // Check for ID patterns
    if (/^[a-zA-Z0-9_-]{10,}$/.test(value)) return "id";
    return "string";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "float";
  }
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "unknown";
}

/**
 * Detect primary key fields based on naming conventions
 */
function detectPrimaryKeys(fields: DiscoveredField[], provider: string): string[] {
  const candidates: string[] = [];

  // Common ID patterns
  const idPatterns = [
    "id",
    `${provider}_id`,
    "campaign_id",
    "adset_id",
    "ad_id",
    "order_id",
    "shop_id",
    "account_id",
  ];

  for (const field of fields) {
    const name = field.name.toLowerCase();
    if (idPatterns.includes(name) || name.endsWith("_id")) {
      candidates.push(field.name);
    }
  }

  // Return first match or "id" if exists
  return candidates.length > 0 ? [candidates[0]] : [];
}

/**
 * Handle schema migration alert
 */
export async function alertOnSchemaChange(
  connectionId: string,
  provider: string,
  result: {
    isNew: boolean;
    hasChanges: boolean;
    breakingChanges: number;
  }
): Promise<void> {
  if (!result.hasChanges) return;

  // Get connection details
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { name: true, workspaceId: true },
  });

  if (!connection) return;

  if (result.breakingChanges > 0) {
    // Critical: Breaking changes detected
    logger.error(
      `[Schema Change] CRITICAL: ${result.breakingChanges} breaking changes in ${provider} for ${connection.name}`
    );

    // TODO: Send alert via Telegram/email
    // await sendAlert({
    //   severity: "critical",
    //   message: `Breaking API changes detected in ${provider}`,
    //   workspaceId: connection.workspaceId,
    // });
  } else {
    // Non-breaking changes
    logger.warn(
      `[Schema Change] Non-breaking changes detected in ${provider} for ${connection.name}`
    );
  }
}

/**
 * Validate data against schema
 */
export function validateAgainstSchema(
  data: any,
  schema: SchemaDiscovery
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Data is not an object"] };
  }

  const schemaFields = new Map(schema.fields.map((f) => [f.name, f]));

  // Check required fields
  for (const field of schema.fields) {
    if (!field.nullable && !(field.name in data)) {
      errors.push(`Missing required field: ${field.name}`);
    }
  }

  // Check for unknown fields
  for (const key of Object.keys(data)) {
    if (!schemaFields.has(key)) {
      errors.push(`Unknown field: ${key}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
