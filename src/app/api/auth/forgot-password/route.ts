import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/mail";
import { PRODUCT_SITE_URL } from "@/lib/site-url";
import crypto from "crypto";
import { logger } from "@/lib/logger";

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

        const baseUrl = process.env.NEXTAUTH_URL || PRODUCT_SITE_URL;
        const resetUrl = `${baseUrl}/reset-password?token=${token}`;

        const mail = await sendPasswordResetEmail(email, resetUrl);
        if (!mail.success) {
            logger.error("[FORGOT PASSWORD] Resend failed:", mail.error);
            // Still return success so response does not reveal whether the email exists
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        logger.error("[FORGOT PASSWORD] Error:", error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === "P2021" || error.code === "P2003") {
                return NextResponse.json(
                    {
                        error:
                            "Password reset is temporarily unavailable. Run database migrations (PasswordResetToken table) or contact support.",
                    },
                    { status: 503 }
                );
            }
        }
        return NextResponse.json(
            { error: "Something went wrong. Please try again later." },
            { status: 500 }
        );
    }
}
