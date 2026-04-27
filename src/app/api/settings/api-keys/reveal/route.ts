import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import {
  emailsEqual,
  getEmailFromGoogleAccessToken,
} from "@/lib/google-access-token-email";
import { logger } from "@/lib/logger";

type RevealBody = {
  workspaceId?: string;
  keyId?: string;
  password?: string;
  googleAccessToken?: string;
};

/**
 * POST — returns the full API key once after step-up:
 * - Users with a password: send `password`.
 * - Google-only accounts (no password): send `googleAccessToken` from OAuth2 token client (openid email).
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RevealBody;
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
    if (!workspaceId || !keyId) {
      return NextResponse.json({ error: "Missing workspaceId or keyId" }, { status: 400 });
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: session.user.id,
        },
      },
    });
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const keyRow = await prisma.apiKey.findFirst({
      where: { id: keyId, workspaceId },
      select: { id: true, key: true, name: true, keyPrefix: true },
    });
    if (!keyRow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { hashedPassword: true, email: true },
    });
    if (!user?.email) {
      return NextResponse.json({ error: "Account email required" }, { status: 400 });
    }

    let verified = false;
    if (user.hashedPassword) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!password) {
        return NextResponse.json(
          { error: "Password required to reveal this key." },
          { status: 400 }
        );
      }
      verified = await bcrypt.compare(password, user.hashedPassword);
    } else {
      const googleAccessToken =
        typeof body.googleAccessToken === "string" ? body.googleAccessToken.trim() : "";
      if (!googleAccessToken) {
        return NextResponse.json(
          {
            error:
              "Google sign-in confirmation required. Use “Confirm with Google” or set a password in account settings.",
          },
          { status: 400 }
        );
      }
      const googleEmail = await getEmailFromGoogleAccessToken(googleAccessToken);
      verified = Boolean(googleEmail && emailsEqual(googleEmail, user.email));
    }

    if (!verified) {
      return NextResponse.json({ error: "Re-authentication failed" }, { status: 401 });
    }

    return NextResponse.json({
      id: keyRow.id,
      name: keyRow.name,
      key: keyRow.key,
      keyPrefix: keyRow.keyPrefix,
    });
  } catch (error) {
    logger.error("[POST api-keys/reveal]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
