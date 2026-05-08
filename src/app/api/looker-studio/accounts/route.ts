import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

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

    let apiKey =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7).trim()
        : req.nextUrl.searchParams.get("apiKey")?.trim() ?? null;

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
      // OAuth2 connector: verify the Google ID token by calling tokeninfo
      const email = await verifyGoogleIdToken(apiKey);
      if (!email) {
        return NextResponse.json({ error: "Invalid or expired Google token" }, { status: 401 });
      }
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json({ error: "No Monstera account found", code: "NO_ACCOUNT" }, { status: 404 });
      }
      const workspace = await prisma.workspace.findFirst({
        where: {
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
        select: { id: true },
      });
      if (!workspace) {
        return NextResponse.json({ error: "No workspace found" }, { status: 404 });
      }
      workspaceId = workspace.id;
    } else {
      // Legacy connector: API key auth
      const keyRecord = await prisma.apiKey.findUnique({
        where: { key: apiKey },
        include: { workspace: true },
      });

      if (!keyRecord) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }
      workspaceId = keyRecord.workspaceId;
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
    logger.error("Looker Studio Accounts API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const email = data.email;
    const verified = data.email_verified;
    const exp = data.exp;
    if (typeof email !== "string" || !email) return null;
    if (String(verified) !== "true") return null;
    if (exp && Number(exp) * 1000 < Date.now()) return null;
    return email;
  } catch {
    return null;
  }
}
