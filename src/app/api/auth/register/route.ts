import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { message: "Missing required fields." },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "User already exists with this email." },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // Create user and a default workspace in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          hashedPassword,
          otp,
          otpExpires,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Personal Workspace",
          slug: `personal-${user.id.slice(0, 8)}`, // Simple unique slug
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              role: "owner"
            }
          }
        }
      });

      return { user, workspace };
    });

    console.log(`[AUTH] OTP for ${email}: ${otp}`); // Log for safety
    
    // Send Real Email via Resend
    try {
      const { sendOtpEmail } = await import("@/lib/mail");
      await sendOtpEmail(email, otp);
    } catch (mailError) {
      console.error("[AUTH] Mail Sending Failed:", mailError);
      // We don't block registration if mail fails, but we log it.
    }

    return NextResponse.json(
      { message: "User created successfully with workspace. Verification code sent." },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error signing up:", error);
    return NextResponse.json(
      { message: "An error occurred during registration." },
      { status: 500 }
    );
  }
}
