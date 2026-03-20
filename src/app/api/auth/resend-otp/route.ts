import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Generate a new 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.user.update({
      where: { email },
      data: {
        otp,
        otpExpires,
      },
    });

    console.log(`[AUTH] Resent OTP for ${email}: ${otp}`); // Log for safety

    // Send Real Email via Resend
    try {
      const { sendOtpEmail } = await import("@/lib/mail");
      await sendOtpEmail(email, otp);
    } catch (mailError) {
      console.error("[AUTH] Resend OTP Mail Failed:", mailError);
    }

    return NextResponse.json({ message: "OTP resent successfully" }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
