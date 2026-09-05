import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  isValidTimeZone,
  SUPPORTED_PROVIDERS,
  type SupportedProvider,
} from "@/lib/report-blueprint";

/**
 * GET /api/reports/blueprint/requirements?workspaceId=&clientId=
 * Returns the explicitly configured reporting requirements for a client
 * (required providers, timezone, currency, destination policy), or null.
 */
export async function GET(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const clientId = searchParams.get("clientId");
    if (!workspaceId || !clientId) {
      return NextResponse.json({ error: "workspaceId and clientId are required" }, { status: 400 });
    }
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });

    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId },
      select: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found in this workspace" }, { status: 404 });
    }
    const requirement = await prisma.clientReportingRequirement.findUnique({
      where: { workspaceId_clientId: { workspaceId, clientId } },
    });
    return NextResponse.json({ requirement, client });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load reporting requirements" },
      { status: 500 },
    );
  }
}

function normalizeProviders(value: unknown): SupportedProvider[] | null {
  if (!Array.isArray(value)) return null;
  const providers = [...new Set(
    value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim()),
  )];
  if (providers.some((provider) => !(SUPPORTED_PROVIDERS as readonly string[]).includes(provider))) {
    return null;
  }
  return providers.sort() as SupportedProvider[];
}

function normalizeCurrency(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) return undefined;
  return value.trim().toUpperCase();
}

/**
 * PUT /api/reports/blueprint/requirements
 * Owner/admin configuration boundary: upserts the client's reporting
 * requirements. Identical content is a no-op so updatedAt (a staleness
 * dependency) only moves when configuration truly changes.
 */
export async function PUT(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const { workspaceId, clientId, requiredProviders, requireDestination, reportingTimezone, reportingCurrency } = body;

    if (!workspaceId || !clientId) {
      return NextResponse.json({ error: "workspaceId and clientId are required" }, { status: 400 });
    }
    const providers = normalizeProviders(requiredProviders);
    if (providers === null) {
      return NextResponse.json(
        { error: `requiredProviders must be a non-empty subset of: ${SUPPORTED_PROVIDERS.join(", ")}` },
        { status: 400 },
      );
    }
    if (providers.length === 0) {
      return NextResponse.json({ error: "At least one required provider must be selected" }, { status: 400 });
    }
    if (reportingTimezone !== undefined && reportingTimezone !== null && !isValidTimeZone(String(reportingTimezone))) {
      return NextResponse.json({ error: "reportingTimezone must be a valid IANA timezone" }, { status: 400 });
    }
    const currency = normalizeCurrency(reportingCurrency);
    if (currency === undefined) {
      return NextResponse.json({ error: "reportingCurrency must be a 3-letter ISO 4217 code" }, { status: 400 });
    }
    const timezone = reportingTimezone === undefined || reportingTimezone === null
      ? null
      : String(reportingTimezone).trim();
    const wantsDestination = Boolean(requireDestination);

    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "admin" });

    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found in this workspace" }, { status: 404 });
    }

    const existing = await prisma.clientReportingRequirement.findUnique({
      where: { workspaceId_clientId: { workspaceId, clientId } },
    });

    const contentUnchanged = existing
      && canonicalRequirementEquals(existing, {
        requiredProviders: providers,
        requireDestination: wantsDestination,
        reportingTimezone: timezone,
        reportingCurrency: currency,
      });
    if (contentUnchanged) {
      return NextResponse.json({ requirement: existing });
    }

    const requirement = await prisma.clientReportingRequirement.upsert({
      where: { workspaceId_clientId: { workspaceId, clientId } },
      create: {
        workspaceId,
        clientId,
        requiredProviders: providers,
        requireDestination: wantsDestination,
        reportingTimezone: timezone,
        reportingCurrency: currency,
      },
      update: {
        requiredProviders: providers,
        requireDestination: wantsDestination,
        reportingTimezone: timezone,
        reportingCurrency: currency,
      },
    });

    return NextResponse.json({ requirement });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save reporting requirements" },
      { status: 500 },
    );
  }
}

function canonicalRequirementEquals(
  existing: {
    requiredProviders: string[];
    requireDestination: boolean;
    reportingTimezone: string | null;
    reportingCurrency: string | null;
  },
  next: {
    requiredProviders: string[];
    requireDestination: boolean;
    reportingTimezone: string | null;
    reportingCurrency: string | null;
  },
): boolean {
  const sameProviders = [...existing.requiredProviders].sort().join(",") === next.requiredProviders.join(",");
  return sameProviders
    && existing.requireDestination === next.requireDestination
    && existing.reportingTimezone === next.reportingTimezone
    && (existing.reportingCurrency ?? null) === next.reportingCurrency;
}
