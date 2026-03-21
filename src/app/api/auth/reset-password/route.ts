import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
    try {
        const { token, password } = await request.json();

        if (!token || !password) {
            return NextResponse.json({ error: "Token and password are required." }, { status: 400 });
        }

        if (password.length < 8) {
            return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
        }

        // Find the token
        const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });

        if (!resetToken) {
            return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
        }

        if (resetToken.expires < new Date()) {
            await prisma.passwordResetToken.delete({ where: { token } });
            return NextResponse.json({ error: "This reset link has expired. Please request a new one." }, { status: 400 });
        }

        // Hash the new password
        const bcrypt = await import("bcryptjs");
        const hashedPassword = await bcrypt.hash(password, 12);

        // Update the user's password
        await prisma.user.update({
            where: { email: resetToken.email },
            data: { hashedPassword }
        });

        // Delete the used token
        await prisma.passwordResetToken.delete({ where: { token } });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("[RESET PASSWORD] Error:", error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
