import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
    try {
        const { email, password } = await request.json();

        const dbUser = await prisma.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
        });

        if (!dbUser) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        if (!dbUser.hashedPassword) {
            return NextResponse.json({ error: "No password hash" }, { status: 400 });
        }

        const isValid = await bcrypt.compare(password, dbUser.hashedPassword);

        return NextResponse.json({
            success: isValid,
            dbUser: { id: dbUser.id, verified: !!dbUser.emailVerified },
            debug: "Check complete"
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message || "Unknown error", stack: e.stack }, { status: 500 });
    }
}
