import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function requirePlatformAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { session: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const operator = await prisma.user.findFirst({
    where: { id: session.user.id, platformRole: "OPERATOR" },
    select: { id: true },
  });
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const isEmailAdmin = Boolean(
    adminEmail && session.user.email?.trim().toLowerCase() === adminEmail,
  );

  if (process.env.NODE_ENV === "production" && !operator && !isEmailAdmin) {
    return { session: null, error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { session, error: null };
}
