import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getToken } from "@/lib/token-cache";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";

export async function GET(request: Request) {
  try {
    const denied = requireCronSecret(request);
    if (denied) return denied;

    logger.info("[CRON: TOKEN PRE-FETCH] Warming up token cache...");

    const connections = await prisma.connection.findMany({
      where: {
        status: "connected",
      },
      select: {
        id: true,
        provider: true,
      },
    });

    let successCount = 0;
    let failCount = 0;

    for (const conn of connections) {
      try {
        // Calling getToken automatically populates the Redis cache on miss
        const token = await getToken(conn.id);
        if (token) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        logger.error(`[CRON: TOKEN PRE-FETCH] Failed for connection ${conn.id}:`, err);
        failCount++;
      }
    }

    logger.info(`[CRON: TOKEN PRE-FETCH] Finished warming cache. Success: ${successCount}, Fail: ${failCount}`);

    return NextResponse.json({
      status: "Success",
      message: "Token pre-fetch cache warming complete.",
      statistics: {
        connectionsScanned: connections.length,
        cacheWarmed: successCount,
        failed: failCount,
      },
    });
  } catch (error) {
    logger.error("[CRON: TOKEN PRE-FETCH] Fatal execution error:", error);
    return new NextResponse("Internal Cron Failure", { status: 500 });
  }
}
