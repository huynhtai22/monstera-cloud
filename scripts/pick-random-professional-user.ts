/**
 * Prints one random user with plan `professional` (for reviewer handoff, QA, etc.).
 * Does not modify the database.
 *
 *   DATABASE_URL=... npx tsx scripts/pick-random-professional-user.ts
 *
 * Optional: SMOKE_SAMPLE=n parseInt for deterministic seed (same DB → same pick).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function seededIndex(seed: number, len: number): number {
    if (len <= 0) return 0;
    const x = Math.sin(seed) * 10000;
    return Math.floor((x - Math.floor(x)) * len);
}

async function main() {
    const users = await prisma.user.findMany({
        where: {
            plan: { equals: "professional", mode: "insensitive" },
        },
        select: {
            id: true,
            email: true,
            name: true,
            plan: true,
            emailVerified: true,
        },
    });

    if (users.length === 0) {
        console.log("No users with plan `professional` found.");
        process.exit(0);
    }

    const seedRaw = process.env.SMOKE_SAMPLE?.trim();
    const seedParsed = seedRaw ? Number.parseInt(seedRaw, 10) : NaN;
    const idx = Number.isFinite(seedParsed)
        ? seededIndex(seedParsed, users.length)
        : Math.floor(Math.random() * users.length);
    const pick = users[idx];

    console.log(JSON.stringify({ count: users.length, pickedIndex: idx, user: pick }, null, 2));
    console.log("\nUse email + your normal password reset flow if you do not have the password.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
