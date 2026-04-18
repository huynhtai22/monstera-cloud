/**
 * Creates the Meta App Review test account directly in the DB.
 * Run with: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/create-meta-reviewer-account.ts
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const email = 'reviewer@monsteracloud.com';
    const password = 'MetaReview2026!';
    const name = 'Meta Reviewer';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        console.log(`✅ Account already exists for: ${email}`);
        return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
        data: {
            email,
            name,
            hashedPassword,
            emailVerified: new Date(),
        }
    });

    const workspace = await prisma.workspace.create({
        data: {
            name: 'Demo Workspace',
            slug: `demo-workspace-meta-reviewer`,
            ownerId: user.id,
            members: {
                create: {
                    userId: user.id,
                    role: 'owner'
                }
            }
        }
    });

    console.log('\n🎉 Meta reviewer account created!\n');
    console.log(`   Email:     ${email}`);
    console.log(`   Password:  ${password}`);
    console.log(`   Workspace: ${workspace.name} (${workspace.id})`);
    console.log(`   User ID:   ${user.id}`);
}

main()
    .catch((e) => {
        console.error('❌ Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

export {};
