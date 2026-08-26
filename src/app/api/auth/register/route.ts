import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import { hashInvitationToken, normalizeEmail } from "@/lib/invitation-security";
import { defaultSignupWorkspacePlan } from "@/lib/plan-config";

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
    const { name, email: rawEmail, password, inviteToken } = await req.json();

    if (!name || !rawEmail || !password) {
      return NextResponse.json(
        { message: "Missing required fields." },
        { status: 400 }
      );
    }

    // Normalize email: trim whitespace and lowercase to enforce single identity
    const email = normalizeEmail(rawEmail);

    if (!(await allowAuthAttempt({ request: req, action: "register", identity: email, limit: 5, windowSeconds: 15 * 60 }))) {
      return NextResponse.json({ message: "Too many attempts. Try again later." }, { status: 429 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { message: "Invalid email address." },
        { status: 400 }
      );
    }

    if (typeof password !== "string" || password.length < 8 || !/[a-z]/.test(password) || !/\d/.test(password)) {
      return NextResponse.json(
        { message: "Password must be at least 8 characters with a lowercase letter and number." },
        { status: 400 },
      );
    }

    let invitationRecord: any = null;
    if (inviteToken && typeof inviteToken === "string") {
      const token = inviteToken.trim();
      const invitation = await prisma.workspaceInvitation.findUnique({
        where: { tokenHash: hashInvitationToken(token) },
      });
      if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date() || normalizeEmail(invitation.email) !== email) {
        return NextResponse.json(
          { message: "A valid pilot invitation for this email is required or the invitation has expired." },
          { status: 400 },
        );
      }
      invitationRecord = invitation;
    }

    // Case-insensitive duplicate check — catches "Tai@gmail.com" vs "tai@gmail.com"
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "Unable to complete registration with those details." },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate a 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
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

      if (invitationRecord) {
        let workspaceId = invitationRecord.workspaceId;
        if (!workspaceId) {
          const ws = await tx.workspace.create({
            data: {
              name: invitationRecord.agencyName || `${name.trim()}'s Agency`,
              slug: invitationRecord.agencySlug || `agency-${user.id.slice(0, 8)}`,
              ownerId: user.id,
              plan: invitationRecord.plan || "pilot",
              status: "PILOT",
              members: { create: { userId: user.id, role: "owner" } },
              providerAccess: {
                create: (invitationRecord.enabledProviders || ["meta_ads", "google_ads", "tiktok_business", "shopee"]).map((provider: string) => ({
                  provider,
                  enabled: true,
                })),
              },
            },
          });
          workspaceId = ws.id;
        } else {
          await tx.workspaceMember.create({
            data: { workspaceId, userId: user.id, role: invitationRecord.role },
          });
        }

        await tx.workspaceInvitation.update({
          where: { id: invitationRecord.id },
          data: { acceptedAt: new Date(), acceptedByUserId: user.id, workspaceId },
        });
      } else {
        const signup = defaultSignupWorkspacePlan(email);

        await tx.workspace.create({
          data: {
            name: `${name.trim()}'s Agency`,
            slug: `agency-${user.id.slice(0, 8)}`,
            ownerId: user.id,
            plan: signup.plan,
            status: signup.status,
            members: { create: { userId: user.id, role: "owner" } },
            providerAccess: {
              create: [
                { provider: "meta_ads", enabled: true },
                { provider: "google_ads", enabled: true },
                { provider: "tiktok_business", enabled: true },
                { provider: "shopee", enabled: true },
              ],
            },
          },
        });
      }
    });

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
        { message: "Unable to complete registration with those details." },
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
