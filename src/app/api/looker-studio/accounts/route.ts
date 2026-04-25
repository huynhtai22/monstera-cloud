import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * GET /api/looker-studio/accounts
 * 
 * Returns all unique accounts in a workspace for Looker Studio connector config dropdown.
 * Requires valid API key in Authorization header.
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

    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { workspace: true },
    });

    if (!keyRecord) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    // Fetch all unique accounts in workspace, ordered by account name
    const accounts = await prisma.campaignMetric.findMany({
      where: { workspaceId: keyRecord.workspaceId },
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
