import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from "@/lib/google-id-token";
import { resolveApiKey } from "@/lib/api-key-security";
import { assertLookerAllowed, toPlanLimitResponse } from "@/lib/plan-entitlements";

/**
 * GET /api/looker-studio/accounts
 * 
 * Returns all unique accounts in a workspace for Looker Studio connector config dropdown.
 * Supports:
 * - Looker Studio OAuth2 (Google ID token in Authorization header)
 * - Legacy API key auth (Authorization header or apiKey query param)
 * 
 * Response:
 * {
 *   "accounts": [
 *     { "accountId": "123", "accountName": "Meta Account 1" },
 *     { "accountId": "456", "accountName": "Google Ads Account" }
 *   ]
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");

    const apiKey =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7).trim()
        : null;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Unauthorized. Missing API key." },
        { status: 401 }
      );
    }

    // Heuristic: Google ID tokens are JWT-like (3 segments)
    const isGoogleJwt = apiKey.split(".").length === 3 && apiKey.startsWith("eyJ");

    let workspaceId: string | null = null;

    if (isGoogleJwt) {
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
          select: { id: true, plan: true },
        });
      } else {
        workspace = await prisma.workspace.findFirst({
          where: {
            OR: [
              { ownerId: user.id },
              { members: { some: { userId: user.id } } },
            ],
          },
          select: { id: true, plan: true },
          orderBy: { updatedAt: "desc" },
        });
      }
      if (!workspace) {
        return NextResponse.json({ error: "No workspace found", code: "NO_WORKSPACE" }, { status: 404 });
      }
      workspaceId = workspace.id;
      await assertLookerAllowed({ plan: workspace.plan, auth: "jwt-sheets" });
    } else {
      // Legacy connector: API key auth
      const keyRecord = await resolveApiKey(apiKey);

      if (!keyRecord) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }
      workspaceId = keyRecord.workspaceId;
      await assertLookerAllowed({ plan: keyRecord.workspace.plan, auth: "api-key-looker" });
    }

    // Fetch all unique accounts in workspace, ordered by account name
    const accounts = await prisma.campaignMetric.findMany({
      where: { workspaceId: workspaceId as string },
      distinct: ["accountId"],
      select: {
        accountId: true,
        accountName: true,
      },
      orderBy: { accountName: "asc" },
    });

    // Transform to account list format and deduplicate by accountId
    // (in case accountName varies for same accountId)
    const accountMap = new Map<
      string,
      { accountId: string; accountName: string }
    >();

    accounts.forEach((account) => {
      if (account.accountId && !accountMap.has(account.accountId)) {
        accountMap.set(account.accountId, {
          accountId: account.accountId,
          accountName: account.accountName || "Unknown Account",
        });
      }
    });

    const accountList = Array.from(accountMap.values()).sort((a, b) =>
      (a.accountName || "").localeCompare(b.accountName || "")
    );

    return NextResponse.json({ accounts: accountList });
  } catch (error: unknown) {
    const planLimit = toPlanLimitResponse(error);
    if (planLimit) return planLimit;
    logger.error("Looker Studio Accounts API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
