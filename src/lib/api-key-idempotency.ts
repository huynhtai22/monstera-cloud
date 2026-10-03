import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { decrypt, encrypt } from "@/lib/encryption";

export const API_KEY_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

export class ApiKeyIdempotencyError extends Error {
  constructor(
    message: string,
    readonly code: "IDEMPOTENCY_KEY_REQUIRED" | "IDEMPOTENCY_KEY_INVALID" | "IDEMPOTENCY_CONFLICT" | "IDEMPOTENCY_RECEIPT_EXPIRED",
    readonly statusCode: 400 | 409,
  ) {
    super(message);
    this.name = "ApiKeyIdempotencyError";
  }
}

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!value) {
    throw new ApiKeyIdempotencyError(
      "Idempotency-Key is required for API-key creation and rotation.",
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
    );
  }
  if (value.length < 16 || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ApiKeyIdempotencyError(
      "Idempotency-Key must be 16-200 URL-safe characters.",
      "IDEMPOTENCY_KEY_INVALID",
      400,
    );
  }
  return value;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function apiKeyMutationRequestHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export async function runIdempotentApiKeyMutation<T extends Record<string, unknown>>(input: {
  tx: Prisma.TransactionClient;
  workspaceId: string;
  actorUserId: string;
  operation: "create" | "rotate";
  idempotencyKey: string;
  requestHash: string;
  now?: Date;
  create: () => Promise<{ response: T; statusCode: number; apiKeyId?: string | null }>;
}): Promise<{ response: T; statusCode: number; created: boolean }> {
  const now = input.now ?? new Date();
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const receipt = await input.tx.apiKeyMutationReceipt.findUnique({
    where: {
      workspaceId_actorUserId_operation_idempotencyKeyHash: {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        operation: input.operation,
        idempotencyKeyHash,
      },
    },
  });

  if (receipt) {
    if (receipt.requestHash !== input.requestHash) {
      throw new ApiKeyIdempotencyError(
        "This Idempotency-Key was already used for a different request.",
        "IDEMPOTENCY_CONFLICT",
        409,
      );
    }
    if (receipt.expiresAt <= now) {
      throw new ApiKeyIdempotencyError(
        "The recoverable API-key receipt has expired. Start a new operation with a new Idempotency-Key.",
        "IDEMPOTENCY_RECEIPT_EXPIRED",
        409,
      );
    }
    return {
      response: JSON.parse(decrypt(receipt.responseCiphertext)) as T,
      statusCode: receipt.statusCode,
      created: false,
    };
  }

  const result = await input.create();
  await input.tx.apiKeyMutationReceipt.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      operation: input.operation,
      idempotencyKeyHash,
      requestHash: input.requestHash,
      responseCiphertext: encrypt(JSON.stringify(result.response)),
      statusCode: result.statusCode,
      apiKeyId: result.apiKeyId ?? null,
      expiresAt: new Date(now.getTime() + API_KEY_RECEIPT_TTL_MS),
    },
  });
  return { response: result.response, statusCode: result.statusCode, created: true };
}

export function toApiKeyIdempotencyResponse(error: unknown): Response | null {
  if (!(error instanceof ApiKeyIdempotencyError)) return null;
  return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
}
