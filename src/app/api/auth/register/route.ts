import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail";
import { logger } from "@/lib/logger";

/**
 * GET handler - Explicitly reject GET requests to prevent sensitive data
 * from being exposed in URL query parameters (OWASP security requirement)
 */
export async function GET() {
  return NextResponse.json(
    { message: "Method not allowed. Use POST to register." },
    { status: 405 }
  );
}

export async function POST(req: Request) {
  try {
    const { name, email: rawEmail, password } = await req.json();

    if (!name || !rawEmail || !password) {
      return NextResponse.json(
        { message: "Missing required fields." },
        { status: 400 }
      );
    }

    // Normalize email: trim whitespace and lowercase to enforce single identity
    const email = rawEmail.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { message: "Invalid email address." },
        { status: 400 }
      );
    }

    // Case-insensitive duplicate check — catches "Tai@gmail.com" vs "tai@gmail.com"
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "An account with this email already exists." },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Atomic transaction: user + workspace + membership — all or nothing
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: name.trim(),
          email, // always store normalized lowercase
          hashedPassword,
          otp,
          otpExpires,
        },
      });

      await tx.workspace.create({
        data: {
          name: "Personal Workspace",
          slug: `personal-${user.id.slice(0, 8)}`,
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              role: "owner",
            },
          },
        },
      });
    });

    logger.info(`[AUTH] OTP for ${email}: ${otp}`);

    // Send verification email — non-fatal: user can request resend
    try {
      await sendOtpEmail(email, otp);
    } catch (mailError) {
      logger.error("[AUTH] Mail sending failed:", mailError);
    }

    return NextResponse.json(
      { message: "Account created. Verification code sent." },
      { status: 201 }
    );
  } catch (error: any) {
    // Surface Prisma unique constraint violations as user-facing messages
    // rather than raw 500s (e.g. race condition on concurrent registrations)
    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "An account with this email already exists." },
        { status: 400 }
      );
    }
    logger.error("[AUTH] Registration error:", error);
    return NextResponse.json(
      { message: "An error occurred during registration." },
      { status: 500 }
    );
  }
}
