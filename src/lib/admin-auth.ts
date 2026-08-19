import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const PLATFORM_ADMIN_EMAILS = [
  "huynhcamtai1234@gmail.com",
  "huynhtai@monsteracloud.com",
];

export function isPlatformAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const adminEnv = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEnv && normalized === adminEnv) return true;
  return PLATFORM_ADMIN_EMAILS.includes(normalized);
}

export async function requirePlatformAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { session: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const isEmailAdmin = isPlatformAdminEmail(session.user.email);
  if (isEmailAdmin) {
    return { session, error: null };
  }

  const operator = await prisma.user.findFirst({
    where: { id: session.user.id, platformRole: "OPERATOR" },
    select: { id: true },
  });

  if (!operator && !isEmailAdmin) {
    return { session: null, error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { session, error: null };
}
