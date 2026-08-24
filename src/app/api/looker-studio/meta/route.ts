import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from "@/lib/google-id-token";
import { resolveApiKey } from "@/lib/api-key-security";
import { getCachedQuery, setCachedQuery } from "@/lib/redis-cache";

function isGoogleJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts[0].startsWith('eyJ');
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const apiKey =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7).trim()
        : null;

    if (!apiKey) {
      return NextResponse.json({ error: "Unauthorized. Missing API key." }, { status: 401 });
    }

    let workspaceId: string;

    if (isGoogleJwt(apiKey)) {
      const verification = await verifyGoogleIdToken(apiKey, {
        audiences: getGoogleIdTokenAudienceAllowlist(),
      });
      if (!verification) {
        return NextResponse.json({ error: "Invalid or expired Google token" }, { status: 401 });
      }
      const user = await prisma.user.findUnique({ where: { email: verification.email } });
      if (!user) {
        return NextResponse.json({ error: "No Monstera account found", code: "NO_ACCOUNT" }, { status: 404 });
      }
      const requestedWorkspaceId = req.nextUrl.searchParams.get("workspaceId")?.trim();
      let workspace;
      if (requestedWorkspaceId) {
        workspace = await prisma.workspace.findFirst({
          where: {
            id: requestedWorkspaceId,
            members: { some: { userId: user.id } },
          },
          select: { id: true },
        });
      } else {
        workspace = await prisma.workspace.findFirst({
          where: {
            OR: [
              { ownerId: user.id },
              { members: { some: { userId: user.id } } },
            ],
          },
          select: { id: true },
          orderBy: { updatedAt: "desc" },
        });
      }
      if (!workspace) {
        return NextResponse.json({ error: "No workspace found", code: "NO_WORKSPACE" }, { status: 404 });
      }
      workspaceId = workspace.id;
    } else {
      const keyRecord = await resolveApiKey(apiKey);
      if (!keyRecord) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      workspaceId = keyRecord.workspaceId;
    }
    const startDateParam = req.nextUrl.searchParams.get("startDate");
    const endDateParam = req.nextUrl.searchParams.get("endDate");
    const platform = req.nextUrl.searchParams.get("platform");

    const cacheKey = `looker:meta:${workspaceId}:${startDateParam || ''}:${endDateParam || ''}:${platform || 'all'}`;
    const cached = await getCachedQuery<unknown>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const where: any = { workspaceId };
    if (platform && platform !== 'all') where.platform = platform;
    if (startDateParam || endDateParam) {
      where.date = {};
      if (startDateParam) {
        const d = new Date(startDateParam + 'T00:00:00Z');
        where.date.gte = d;
      }
      if (endDateParam) {
        const d = new Date(endDateParam + 'T00:00:00Z');
        where.date.lte = new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
      }
    }

    const totalRows = await prisma.campaignMetric.count({ where });

    // Return list of distinct accountIds and platforms
    const accounts = await prisma.campaignMetric.findMany({
      where,
      distinct: ['accountId'],
      select: { accountId: true, accountName: true },
      orderBy: { accountName: 'asc' },
    });

    const platforms = await prisma.campaignMetric.findMany({
      where,
      distinct: ['platform'],
      select: { platform: true },
    });

    const res = {
      totalRows,
      accounts: accounts.map(a => ({ accountId: a.accountId, accountName: a.accountName || 'Unknown' })),
      platforms: platforms.map(p => p.platform),
    };

    await setCachedQuery(cacheKey, res, 60);

    return NextResponse.json(res);
  } catch (e) {
    logger.error('Looker Studio Meta API Error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
