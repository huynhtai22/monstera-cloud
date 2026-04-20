const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const conns = await prisma.connection.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    console.log(JSON.stringify(conns, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
