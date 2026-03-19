const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Querying...');
  const result = await prisma.workspace.findMany();
  console.log('Got result:', result.length, 'workspaces');
}
main().catch(console.error).finally(() => prisma.$disconnect());
