import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const conns = await prisma.connection.findMany({
    where: { provider: 'google_ads' }
  });
  
  for (const conn of conns) {
    console.log(`Connection ID: ${conn.id}, Workspace: ${conn.workspaceId}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
