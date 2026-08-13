import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";

/** Reject GET — new passwords must only appear in POST bodies (CWE-598). */
export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST with JSON body { token, password }." },
    { status: 405 },
  );
}

export async function POST(request: Request) {
    try {
        const { token, password } = await request.json();

        if (!token || !password) {
            return NextResponse.json({ error: "Token and password are required." }, { status: 400 });
        }
        if (!(await allowAuthAttempt({ request, action: "reset_password", identity: String(token).slice(0, 16), limit: 6, windowSeconds: 15 * 60 }))) {
            return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
        }

        if (typeof password !== "string" || password.length < 8 || !/[a-z]/.test(password) || !/\d/.test(password)) {
            return NextResponse.json({ error: "Password must be at least 8 characters with a lowercase letter and number." }, { status: 400 });
        }

        const tokenHash = crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
        const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: tokenHash } });

        if (!resetToken) {
            return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
        }

        if (resetToken.expires < new Date()) {
            await prisma.passwordResetToken.delete({ where: { token: tokenHash } });
            return NextResponse.json({ error: "This reset link has expired. Please request a new one." }, { status: 400 });
        }

        // Hash the new password
        const bcrypt = await import("bcryptjs");
        const hashedPassword = await bcrypt.hash(password, 12);

        // Update password and mark email verified — inbox link proves ownership (same as OTP verify).
        await prisma.$transaction(async (tx) => {
            const consumed = await tx.passwordResetToken.deleteMany({
                where: { token: tokenHash, expires: { gt: new Date() } },
            });
            if (consumed.count !== 1) throw new Error("RESET_TOKEN_CONSUMED");
            await tx.user.update({
                where: { email: resetToken.email },
                data: { hashedPassword, emailVerified: new Date() },
            });
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        if (error instanceof Error && error.message === "RESET_TOKEN_CONSUMED") {
            return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
        }
        logger.error("[RESET PASSWORD] Error:", error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
