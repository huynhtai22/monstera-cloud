import { NextResponse } from "next/server";
import { prismaBase } from "@/lib/prisma";
import { ShopeeClient } from "@/lib/shopee";
import { isShopeeSandboxEnabled } from "@/lib/shopee-env";
import {
  getAccessTokenExpiresAtMs,
  normalizeStoredShopeeCreds,
  serializeShopeeStoredCreds,
  SHOPEE_CRON_REFRESH_WINDOW_MS,
  SHOPEE_DEFAULT_EXPIRE_IN_SEC,
} from "@/lib/shopee-credential-utils";
import { encrypt, safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";

export async function GET(request: Request) {
  try {
    const denied = requireCronSecret(request);
    if (denied) return denied;

    logger.info("[CRON: SHOPEE REFRESH] Fleet token refresh starting…");

    // Fleet enumeration is a trusted, cron-authenticated server operation. Do not route
    // this query through the request-scoped guard: AsyncLocalStorage context can be lost
    // inside Prisma's extension boundary in production. `prismaBase` is explicit and this
    // route never accepts a caller-provided workspace ID.
    const connections = await prismaBase.connection.findMany({
      where: { provider: "shopee", status: "connected" },
    });

    const now = Date.now();
    const shopeeClient = new ShopeeClient();
    let refreshedCount = 0;
    let failedCount = 0;

    for (const conn of connections) {
      try {
        const raw = JSON.parse(safeDecrypt(conn.credentials)) as Record<
          string,
          unknown
        >;
        const creds = normalizeStoredShopeeCreds(raw);

        if (!creds.refresh_token || !creds.shop_id) {
          logger.warn(`[CRON: SHOPEE REFRESH] Skip ${conn.id}: missing refresh_token or shop_id`);
          continue;
        }

        const expirationTimeMs = getAccessTokenExpiresAtMs(creds, conn.updatedAt);

        if (expirationTimeMs - now >= SHOPEE_CRON_REFRESH_WINDOW_MS) {
          continue;
        }

        logger.info(`[CRON: SHOPEE REFRESH] Refreshing connection ${conn.id}`);

        const isSandbox =
          creds.sandbox === true || isShopeeSandboxEnabled();
        const newTokenData = await shopeeClient.refreshAccessToken(
          creds.refresh_token,
          creds.shop_id,
          isSandbox
        );

        const updated = normalizeStoredShopeeCreds({
          access_token: newTokenData.access_token,
          refresh_token: newTokenData.refresh_token,
          expire_in: newTokenData.expire_in ?? SHOPEE_DEFAULT_EXPIRE_IN_SEC,
          shop_id: creds.shop_id,
          sandbox: isSandbox,
        });

        await prismaBase.connection.update({
          where: { id: conn.id },
          data: {
            credentials: encrypt(
              JSON.stringify(
                serializeShopeeStoredCreds(updated, { markTokenFresh: true })
              )
            ),
          },
        });

        await prismaBase.auditEvent.create({
          data: {
            workspaceId: conn.workspaceId,
            action: "system.shopee_token_refreshed",
            resource: "connection",
            resourceId: conn.id,
            metadata: { provider: "shopee" },
          },
        });

        refreshedCount++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          `[CRON: SHOPEE REFRESH] Failed for connection ${conn.id}:`,
          message
        );
        await prismaBase.auditEvent.create({
          data: {
            workspaceId: conn.workspaceId,
            action: "system.shopee_token_refresh_failed",
            resource: "connection",
            resourceId: conn.id,
            metadata: { provider: "shopee", error: message.slice(0, 500) },
          },
        });
        failedCount++;
      }
    }

    return NextResponse.json({
      status: "Success",
      message: "Shopee Token Refresh Cron executed.",
      statistics: {
        scanned: connections.length,
        refreshed: refreshedCount,
        failed: failedCount,
      },
    });
  } catch (error) {
    logger.error("[CRON: SHOPEE REFRESH] Fatal execution error:", error);
    return new NextResponse("Internal Cron Failure", { status: 500 });
  }
}
