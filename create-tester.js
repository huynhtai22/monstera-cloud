const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('ShopeeApprove2026!', 10);
  
  const user = await prisma.user.upsert({
    where: { email: 'shopee-reviewer@monsteracloud.com' },
    update: {
      hashedPassword: hashedPassword
    },
    create: {
      name: 'Shopee Review Team',
      email: 'shopee-reviewer@monsteracloud.com',
      hashedPassword,
    },
  });
  
  console.log('Successfully created test account!');
  console.log('Email:', user.email);
  console.log('Password: ShopeeApprove2026!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
