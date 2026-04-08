import prisma from "@/lib/prisma";
import { encrypt, isEncrypted } from "@/lib/encryption";

/**
 * One-time migration to encrypt legacy plain-text Connection.credentials.
 *
 * Usage:
 *   ENCRYPTION_KEY=... DATABASE_URL=... npx tsx prisma/scripts/encrypt-connection-credentials.ts
 */
async function main() {
  const batchSize = 200;
  let lastId: string | undefined;
  let updated = 0;
  let scanned = 0;

  for (;;) {
    const rows = await prisma.connection.findMany({
      take: batchSize,
      ...(lastId
        ? {
            skip: 1,
            cursor: { id: lastId },
          }
        : {}),
      orderBy: { id: "asc" },
      select: { id: true, credentials: true },
    });

    if (rows.length === 0) break;
    for (const r of rows) {
      scanned++;
      lastId = r.id;
      if (!r.credentials || isEncrypted(r.credentials)) continue;
      await prisma.connection.update({
        where: { id: r.id },
        data: { credentials: encrypt(r.credentials) },
      });
      updated++;
    }
  }

  console.log(
    JSON.stringify({ ok: true, scanned, updated }, null, 2)
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

