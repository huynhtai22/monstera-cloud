import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getToken, invalidateToken } from "@/lib/token-cache";
import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh";
import { recordAccountOutcome, categorizeProviderError } from "@/lib/provider-account-health";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";
import { withSystemScope } from "@/lib/tenant-guard";

export async function GET(request: Request) {
  try {
    const denied = requireCronSecret(request);
    if (denied) return denied;

    logger.info("[CRON: TOKEN PRE-FETCH] Proactive token refresh & cache warming...");

    return await withSystemScope(async () => {
      const connections = await prisma.connection.findMany({
        where: {
          status: "connected",
          type: "source",
        },
        select: {
          id: true,
          provider: true,
          credentials: true,
          workspaceId: true,
          remoteAccountId: true,
        },
      });

      let successCount = 0;
      let failCount = 0;

      for (const conn of connections) {
        try {
          // Check and proactively refresh expiring tokens
          const accessToken = await getValidOAuthToken({
            id: conn.id,
            credentials: conn.credentials,
            provider: conn.provider,
          });

          if (accessToken) {
            successCount++;
            // Populate Redis token cache
            await getToken(conn.id);
          } else {
            failCount++;
          }
        } catch (err: any) {
          const message = err instanceof Error ? err.message : String(err);
          const errorCategory = categorizeProviderError(message);
          logger.error(`[CRON: TOKEN PRE-FETCH] Failed for ${conn.provider} connection ${conn.id}:`, err);
          failCount++;

          // If authorization has expired or was revoked, isolate it promptly
          if (errorCategory === "AUTH_EXPIRED") {
            await prisma.connection.update({
              where: { id: conn.id },
              data: {
                lastError: message.slice(0, 1900),
              },
            });
            await invalidateToken(conn.id);
            if (conn.remoteAccountId) {
              await recordAccountOutcome({
                workspaceId: conn.workspaceId,
                connectionId: conn.id,
                provider: conn.provider,
                accountId: conn.remoteAccountId,
                ok: false,
                authFailure: true,
                error: message,
              });
            }
          }
        }
      }

      logger.info(`[CRON: TOKEN PRE-FETCH] Finished token scan. Success: ${successCount}, Fail: ${failCount}`);

      return NextResponse.json({
        status: "Success",
        message: "Token pre-fetch & proactive refresh complete.",
        statistics: {
          connectionsScanned: connections.length,
          cacheWarmed: successCount,
          failed: failCount,
        },
      });
    });
  } catch (error) {
    logger.error("[CRON: TOKEN PRE-FETCH] Fatal execution error:", error);
    return new NextResponse("Internal Cron Failure", { status: 500 });
  }
}
