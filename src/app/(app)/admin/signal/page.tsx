import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdminEmail } from "@/lib/admin-auth";
import { PageShell } from "@/components/ui/PageShell";
import { SignalDeskClient } from "./SignalDeskClient";

export const metadata: Metadata = {
  title: "Signal Desk – Monstera Cloud",
  description: "Internal autonomous content intelligence & research desk.",
};

export default async function SignalDeskPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email || !isPlatformAdminEmail(session.user.email)) {
    redirect("/console");
  }

  return (
    <PageShell className="max-w-7xl">
      <SignalDeskClient userEmail={session.user.email} />
    </PageShell>
  );
}
