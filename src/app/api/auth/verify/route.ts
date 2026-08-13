import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import { normalizeEmail } from "@/lib/invitation-security";

/** Reject GET so OTPs are never sent in URL query parameters (CWE-598). */
export async function GET() {
  return NextResponse.json(
    { message: "Method not allowed. Use POST with JSON body { email, otp }." },
    { status: 405 },
  );
}

export async function POST(req: Request) {
  try {
    const { email: rawEmail, otp } = await req.json();

    if (!rawEmail || !otp) {
      return NextResponse.json({ message: "Email and OTP are required" }, { status: 400 });
    }
    const email = normalizeEmail(String(rawEmail));
    if (!(await allowAuthAttempt({ request: req, action: "verify_otp", identity: email, limit: 10, windowSeconds: 15 * 60 }))) {
      return NextResponse.json({ message: "Too many attempts. Try again later." }, { status: 429 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json({ message: "Invalid or expired verification code" }, { status: 400 });
    }

    if (user.otpLockedUntil && user.otpLockedUntil > new Date()) {
      return NextResponse.json({ message: "Too many attempts. Try again later." }, { status: 429 });
    }

    if (!user.otp || user.otp !== String(otp) || !user.otpExpires || user.otpExpires < new Date()) {
      const attempts = user.otpAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: attempts >= 5
          ? { otpAttempts: 0, otpLockedUntil: new Date(Date.now() + 15 * 60 * 1000) }
          : { otpAttempts: attempts },
      });
      return NextResponse.json({ message: "Invalid or expired verification code" }, { status: 400 });
    }

    // Success: Verify email and clear OTP
    await prisma.user.update({
      where: { email },
      data: {
        emailVerified: new Date(),
        otp: null,
        otpExpires: null,
        otpAttempts: 0,
        otpLockedUntil: null,
      },
    });

    return NextResponse.json({ message: "Email verified successfully" }, { status: 200 });
  } catch {
    return NextResponse.json({ message: "Verification failed" }, { status: 500 });
  }
}
