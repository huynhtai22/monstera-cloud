import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/mail";
import crypto from "crypto";

export async function POST(request: Request) {
    try {
        const { email } = await request.json();

        if (!email) {
            return NextResponse.json({ error: "Email is required." }, { status: 400 });
        }

        // Always return success to prevent email enumeration attacks
        const user = await prisma.user.findUnique({ where: { email } });
        
        if (!user) {
            return NextResponse.json({ success: true });
        }

        // Invalidate any existing tokens for this email
        await prisma.passwordResetToken.deleteMany({ where: { email } });

        // Generate a secure random token
        const token = crypto.randomBytes(32).toString("hex");
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await prisma.passwordResetToken.create({
            data: { email, token, expires }
        });

        const baseUrl = process.env.NEXTAUTH_URL || "https://monsteracloud.com";
        const resetUrl = `${baseUrl}/reset-password?token=${token}`;

        await sendPasswordResetEmail(email, resetUrl);

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("[FORGOT PASSWORD] Error:", error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
