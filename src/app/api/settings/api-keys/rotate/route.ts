import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { generateApiKey, withApiKeyMutationLock } from "@/lib/api-key-security";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { assertCanCreateApiKeyWithClient, toPlanLimitResponse } from "@/lib/plan-entitlements";
import {
  apiKeyMutationRequestHash,
  requireIdempotencyKey,
  runIdempotentApiKeyMutation,
  toApiKeyIdempotencyResponse,
} from "@/lib/api-key-idempotency";

/**
 * POST /api/settings/api-keys/rotate — P2 key rotation.
 * Body: `{ workspaceId, id }`. Creates a replacement key and revokes the
 * old one atomically. The old secret stops working immediately, so callers
 * should update Looker/Sheets configs right away. Returns the new secret
 * once (never stored in plain text).
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { workspaceId, id } = await request.json();
    if (!workspaceId || typeof id !== "string") {
      return NextResponse.json({ error: "Missing workspaceId or id" }, { status: 400 });
    }

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "rotate_api_key",
    });
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await withApiKeyMutationLock(workspaceId, async (tx) => {
      return runIdempotentApiKeyMutation<Record<string, unknown>>({
        tx,
        workspaceId,
        actorUserId: session.user.id,
        operation: "rotate",
        idempotencyKey,
        requestHash: apiKeyMutationRequestHash({ workspaceId, id }),
        create: async () => {
          const existing = await tx.apiKey.findFirst({
            where: { id, workspaceId, revokedAt: null },
            select: { id: true, name: true },
          });
          if (!existing) {
            return {
              response: { error: "API key not found", code: "API_KEY_NOT_FOUND" },
              statusCode: 404,
              apiKeyId: null,
            };
          }
          // Rotation is net-zero on key count: exclude the key being replaced so
          // workspaces already at cap can still rotate.
          await assertCanCreateApiKeyWithClient(tx, workspaceId, { excludingKeyId: id });
          const generated = generateApiKey();
          const created = await tx.apiKey.create({
            data: {
              keyHash: generated.keyHash,
              keyPrefix: generated.keyPrefix,
              keyLastFour: generated.keyLastFour,
              name: existing.name,
              workspaceId,
              createdByUserId: session.user.id,
            },
          });
          await tx.apiKey.update({
            where: { id: existing.id },
            data: { revokedAt: new Date() },
          });
          await tx.auditEvent.create({
            data: {
              workspaceId,
              actorUserId: session.user.id,
              action: "api_key.rotated",
              resource: "api_key",
              resourceId: created.id,
              metadata: { fromKeyId: existing.id },
            },
          });
          return {
            response: {
              id: created.id,
              name: created.name,
              workspaceId: created.workspaceId,
              createdAt: created.createdAt,
              key: generated.secret,
            },
            statusCode: 201,
            apiKeyId: created.id,
          };
        },
      });
    });
    return NextResponse.json(result.response, {
      status: result.statusCode,
      headers: { "Idempotent-Replayed": result.created ? "false" : "true" },
    });
  } catch (error) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    const planLimit = toPlanLimitResponse(error);
    if (planLimit) return planLimit;
    const idempotency = toApiKeyIdempotencyResponse(error);
    if (idempotency) return idempotency;
    logger.error("Error rotating API key:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
