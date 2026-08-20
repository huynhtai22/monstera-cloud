import { prismaBase } from "@/lib/prisma";
import { remediateStoredCredentials } from "@/lib/credential-remediation";
import { logger } from "@/lib/logger";

/**
 * One-time migration to encrypt legacy plain-text Connection.credentials.
 *
 * Usage:
 *   ENCRYPTION_KEY=... DATABASE_URL=... npx tsx prisma/scripts/encrypt-connection-credentials.ts
 *
 * Dry run (no writes):
 *   ENCRYPTION_KEY=... DATABASE_URL=... npx tsx prisma/scripts/encrypt-connection-credentials.ts --dry-run
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const batchSize = 200;
  let lastId: string | undefined;
  let updated = 0;
  let scanned = 0;
  let encrypted = 0;
  let reconnectRequired = 0;
  let wouldEncrypt = 0;
  let wouldRequireReconnect = 0;

  for (;;) {
    // This is an operator-only remediation command. It intentionally uses the base client
    // because it must inspect every workspace without accepting user-supplied scope.
    const rows = await prismaBase.connection.findMany({
      take: batchSize,
      ...(lastId
        ? {
            skip: 1,
            cursor: { id: lastId },
          }
        : {}),
      orderBy: { id: "asc" },
      select: { id: true, workspaceId: true, provider: true, credentials: true },
    });

    if (rows.length === 0) break;
    for (const r of rows) {
      scanned++;
      lastId = r.id;
      const remediation = remediateStoredCredentials(r.credentials);
      if (remediation.action === "unchanged") continue;
      if (remediation.action === "encrypted") wouldEncrypt++;
      else wouldRequireReconnect++;
      if (dryRun) continue;
      if (remediation.action === "encrypted") {
        await prismaBase.connection.update({ where: { id: r.id }, data: { credentials: remediation.credentials } });
        await prismaBase.auditEvent.create({ data: { workspaceId: r.workspaceId, action: "connection.credentials.encrypted", resource: "connection", resourceId: r.id, metadata: { provider: r.provider } } });
        encrypted++;
      } else {
        await prismaBase.connection.update({
          where: { id: r.id },
          data: { credentials: remediation.credentials, status: "error", lastError: "Reconnect required to restore this source." },
        });
        await prismaBase.auditEvent.create({ data: { workspaceId: r.workspaceId, action: "connection.credentials.reconnect_required", resource: "connection", resourceId: r.id, metadata: { provider: r.provider, reason: remediation.reason } } });
        // No plaintext is included in this diagnostic.
        logger.error("[CREDENTIAL_REMEDIATION_RECONNECT_REQUIRED]", { connectionId: r.id, workspaceId: r.workspaceId, provider: r.provider, reason: remediation.reason });
        reconnectRequired++;
      }
      updated++;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        scanned,
        updated: dryRun ? 0 : updated,
        encrypted,
        reconnectRequired,
        wouldEncrypt,
        wouldRequireReconnect,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaBase.$disconnect();
  });
