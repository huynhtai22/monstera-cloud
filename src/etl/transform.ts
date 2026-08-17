/**
 * In-flight Normalization Layer
 *
 * Applies custom field calculations and canonical field mapping
 * after extraction but before loading.
 *
 * Supports:
 * - Field renaming (e.g., Facebook "Spend" -> canonical "spend")
 * - Custom formulas (e.g., "spend * 1.2")
 * - Conditional transforms (e.g., only for meta_ads)
 * - UTM normalization
 */

import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { normalizeUtmValue } from "@/etl/normalize/naming";

// ─── Canonical field name mapping ─────────────────────────────────────

const FIELD_ALIASES: Record<string, string> = {
    // Meta Ads
    spend: "spend",
    Spend: "spend",
    amount_spent: "spend",
    // Google Ads
    Cost: "spend",
    cost: "spend",
    CostMicros: "spend",
    // TikTok
    stat_cost: "spend",
    // Engagement
    impressions: "impressions",
    Impressions: "impressions",
    clicks: "clicks",
    Clicks: "clicks",
    // Conversions
    conversions: "conversions",
    Conversions: "conversions",
    actions: "conversions",
    // Revenue
    revenue: "revenue",
    purchase_value: "revenue",
    conversion_value: "revenue",
    // ROAS
    roas: "roas",
    purchase_roas: "roas",
    conv_value_per_cost: "roas",
};

interface TransformContext {
    platform: string;
    pipelineId: string;
    connectionId: string;
    date?: string;
}

interface TransformRule {
    type: string;
    formula?: string;
    targetField?: string;
    dependsOn?: string[];
    condition?: string;
    config: Record<string, unknown>;
}

/**
 * Load transform rules for a pipeline from the database.
 * NOTE: After adding formula/targetField/dependsOn/condition columns to
 * TransformationRule, run `npx prisma generate` for full type safety.
 */
export async function loadTransformRules(pipelineId: string): Promise<TransformRule[]> {
    // Cast to any while Prisma client hasn't been regenerated for new columns
    const rows = (await prisma.transformationRule.findMany({
        where: { pipelineId },
        orderBy: { orderIndex: "asc" },
    })) as any[];

    return rows.map((r: any) => ({
        type: r.type as string,
        formula: (r.formula ?? undefined) as string | undefined,
        targetField: (r.targetField ?? undefined) as string | undefined,
        dependsOn: (r.dependsOn ?? undefined) as string[] | undefined,
        condition: (r.condition ?? undefined) as string | undefined,
        config: safeParseConfig(r.config as string | Record<string, unknown>),
    }));
}

function safeParseConfig(raw: string | Record<string, unknown>): Record<string, unknown> {
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }
    if (typeof raw === "object" && raw !== null) {
        return raw;
    }
    return {};
}

/**
 * Map a single raw record into the canonical schema.
 */
export function mapToCanonical(
    raw: Record<string, unknown>,
    ctx: TransformContext
): Record<string, unknown> {
    const canonical: Record<string, unknown> = {
        platform: ctx.platform,
        pipelineId: ctx.pipelineId,
        connectionId: ctx.connectionId,
        date: ctx.date,
    };

    for (const [rawKey, value] of Object.entries(raw)) {
        const canonicalKey = FIELD_ALIASES[rawKey] || rawKey.toLowerCase().replace(/\s+/g, "_");

        // Numeric coercion
        if (typeof value === "string" && /^[\d.,]+$/.test(value)) {
            const normalized = value.replace(/,/g, "");
            const num = parseFloat(normalized);
            if (!isNaN(num)) {
                canonical[canonicalKey] = num;
                continue;
            }
        }

        // Boolean coercion
        if (typeof value === "string" && (value.toLowerCase() === "true" || value.toLowerCase() === "false")) {
            canonical[canonicalKey] = value.toLowerCase() === "true";
            continue;
        }

        canonical[canonicalKey] = value;
    }

    // Normalize UTM fields if present
    if (raw.utm_source || raw.utm_medium || raw.utm_campaign || raw.utm_content || raw.utm_term) {
        canonical.utm = {
            utm_source: normalizeUtmValue(raw.utm_source as string),
            utm_medium: normalizeUtmValue(raw.utm_medium as string),
            utm_campaign: normalizeUtmValue(raw.utm_campaign as string),
            utm_content: normalizeUtmValue(raw.utm_content as string),
            utm_term: normalizeUtmValue(raw.utm_term as string),
        };
    }

    return canonical;
}

/**
 * Apply custom formula-based calculations.
 * Safe math — only supports +, -, *, /, parentheses, and field references.
 */
export function applyFormula(
    record: Record<string, unknown>,
    formula: string,
    targetField: string
): Record<string, unknown> {
    const safeFields = new Set<string>();
    const fieldValues: Record<string, number> = {};

    // Extract field references and collect values
    const fieldPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    const matches = formula.match(fieldPattern) || [];

    for (const field of matches) {
        safeFields.add(field);
        const val = record[field];
        if (typeof val === "number") {
            fieldValues[field] = val;
        } else if (typeof val === "string") {
            const parsed = parseFloat(val);
            fieldValues[field] = isNaN(parsed) ? 0 : parsed;
        } else {
            fieldValues[field] = 0;
        }
    }

    // Build sanitized expression by replacing field refs with values
    let expr = formula;
    for (const [field, val] of Object.entries(fieldValues)) {
        expr = expr.replace(new RegExp(`\\b${field}\\b`, "g"), String(val));
    }

    // Security: strip anything that's not a number, operator, parentheses, or dot
    const sanitized = expr.replace(/[^0-9+\-*/().\s]/g, "");

    try {
        const result = new Function(`return (${sanitized})`)();
        if (typeof result === "number" && !isNaN(result)) {
            return { ...record, [targetField]: result };
        }
    } catch {
        logger.warn(`[TRANSFORM] Formula evaluation failed: "${formula}" -> "${sanitized}"`);
    }

    return record;
}

/**
 * Evaluate a condition expression against a record.
 * Supports: field == 'value', field != 'value', field > number, field < number
 */
export function evaluateCondition(
    record: Record<string, unknown>,
    condition: string
): boolean {
    try {
        // Simple parser for common patterns
        const eqMatch = condition.match(/^(.+?)\s*==\s*['"]?(.+?)['"]?$/);
        if (eqMatch) {
            const field = eqMatch[1].trim();
            const expected = eqMatch[2].trim().replace(/['"]/g, "");
            return String(record[field] ?? "") === expected;
        }

        const neMatch = condition.match(/^(.+?)\s*!=\s*['"]?(.+?)['"]?$/);
        if (neMatch) {
            const field = neMatch[1].trim();
            const expected = neMatch[2].trim().replace(/['"]/g, "");
            return String(record[field] ?? "") !== expected;
        }

        const gtMatch = condition.match(/^(.+?)\s*>\s*(\d+(?:\.\d+)?)$/);
        if (gtMatch) {
            const field = gtMatch[1].trim();
            const expected = parseFloat(gtMatch[2]);
            const val = parseFloat(String(record[field] ?? 0));
            return val > expected;
        }

        const ltMatch = condition.match(/^(.+?)\s*<\s*(\d+(?:\.\d+)?)$/);
        if (ltMatch) {
            const field = ltMatch[1].trim();
            const expected = parseFloat(ltMatch[2]);
            const val = parseFloat(String(record[field] ?? 0));
            return val < expected;
        }
    } catch {
        return false;
    }

    return false;
}

/**
 * Run the full transform pipeline on an array of records.
 */
export async function transform(
    records: Record<string, unknown>[],
    rules: TransformRule[],
    ctx: TransformContext
): Promise<Record<string, unknown>[]> {
    if (records.length === 0) return records;

    const start = Date.now();
    let transformed = records.map((r) => mapToCanonical(r, ctx));

    for (const rule of rules) {
        if (rule.condition && !evaluateCondition(transformed[0] || {}, rule.condition)) {
            logger.info(`[TRANSFORM] Skipping rule "${rule.type}" — condition "${rule.condition ?? "none"}" not met for platform ${ctx.platform}`);
            continue;
        }

        if (rule.formula && rule.targetField) {
            const formula = rule.formula;
            const targetField = rule.targetField;
            transformed = transformed.map((r) => applyFormula(r, formula, targetField));
        }
    }

    logger.info(`[TRANSFORM] ${records.length} records in ${Date.now() - start}ms for ${ctx.platform}`);
    return transformed;
}
