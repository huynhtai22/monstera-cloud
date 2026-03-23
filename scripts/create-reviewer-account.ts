/**
 * One-time script to create the Shopee reviewer demo account directly in Neon.
 * Run with: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/create-reviewer-account.ts
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const email = 'shopee-reviewer@monsteracloud.com';
    const password = 'MonsteraDemo2026!';
    const name = 'Shopee Reviewer';

    // Check if account already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        console.log(`✅ Account already exists for: ${email}`);
        return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Create the user with emailVerified pre-set (bypass OTP)
    const user = await prisma.user.create({
        data: {
            email,
            name,
            hashedPassword,
            emailVerified: new Date(), // pre-verified, no OTP step needed
        }
    });

    // Create a default workspace for the account
    const workspace = await prisma.workspace.create({
        data: {
            name: 'Demo Workspace',
            slug: 'demo-workspace-reviewer',
            ownerId: user.id,
            members: {
                create: {
                    userId: user.id,
                    role: 'owner'
                }
            }
        }
    });

    console.log('\n🎉 Reviewer account created successfully!\n');
    console.log(`   Email:     ${email}`);
    console.log(`   Password:  ${password}`);
    console.log(`   Workspace: ${workspace.name} (${workspace.slug})`);
    console.log(`   User ID:   ${user.id}`);
    console.log('\n📋 Give these credentials to the Shopee App Reviewer.\n');
}

main()
    .catch((e) => {
        console.error('❌ Error creating account:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

export {};
