import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import { normalizeEmail } from "@/lib/invitation-security";

export async function GET() {
  return NextResponse.json(
    { message: "Method not allowed. Use POST with JSON body { email }." },
    { status: 405 },
  );
}

export async function POST(req: Request) {
  try {
    const { email: rawEmail } = await req.json();

    if (!rawEmail) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }
    const email = normalizeEmail(String(rawEmail));
    if (!(await allowAuthAttempt({ request: req, action: "resend_otp", identity: email, limit: 3, windowSeconds: 15 * 60 }))) {
      return NextResponse.json({ message: "If the account is eligible, a code will be sent shortly." });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json({ message: "If the account is eligible, a code will be sent shortly." });
    }

    if (user.otpExpires && user.otpExpires.getTime() > Date.now() + 9 * 60 * 1000) {
      return NextResponse.json({ message: "If the account is eligible, a code will be sent shortly." });
    }

    // Generate a new 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.user.update({
      where: { email },
      data: {
        otp,
        otpExpires,
        otpAttempts: 0,
        otpLockedUntil: null,
      },
    });

    // Send Real Email via Resend
    try {
      const { sendOtpEmail } = await import("@/lib/mail");
      await sendOtpEmail(email, otp);
    } catch (mailError) {
      logger.error("[AUTH] Resend OTP Mail Failed:", mailError);
    }

    return NextResponse.json({ message: "If the account is eligible, a code will be sent shortly." }, { status: 200 });
  } catch (error: unknown) {
    logger.error("[AUTH] Resend OTP failed:", error);
    return NextResponse.json({ message: "If the account is eligible, a code will be sent shortly." });
  }
}
