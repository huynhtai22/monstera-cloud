import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PilotProvisioningClient } from "./PilotProvisioningClient";
import { notFound } from "next/navigation";

export default async function PilotAdminPage() {
  const session = await getServerSession(authOptions);
  const operator = session?.user?.id
    ? await prisma.user.findFirst({ where: { id: session.user.id, platformRole: "OPERATOR" }, select: { id: true } })
    : null;
  if (!operator) {
    notFound();
  }
  return <PilotProvisioningClient />;
}
