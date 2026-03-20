
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { email, otp } = await req.json();

    if (!email || !otp) {
      return NextResponse.json({ message: "Email and OTP are required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    if (user.otp !== otp) {
      return NextResponse.json({ message: "Invalid OTP" }, { status: 400 });
    }

    if (user.otpExpires && user.otpExpires < new Date()) {
      return NextResponse.json({ message: "OTP has expired" }, { status: 400 });
    }

    // Success: Verify email and clear OTP
    await prisma.user.update({
      where: { email },
      data: {
        emailVerified: new Date(),
        otp: null,
        otpExpires: null,
      },
    });

    return NextResponse.json({ message: "Email verified successfully" }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
