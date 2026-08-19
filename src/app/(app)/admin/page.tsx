import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdminEmail } from "@/lib/admin-auth";
import { PageShell } from "@/components/ui/PageShell";
import { ExecutiveDashboardClient } from "./ExecutiveDashboardClient";

export const metadata: Metadata = {
    title: "Finance & Admin – Monstera Cloud",
    description: "Incidents, support tickets, and finance for platform operators.",
};

export default async function AdminDashboardPage() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        redirect("/login?callbackUrl=/admin");
    }

    if (!isPlatformAdminEmail(session.user.email)) {
        redirect("/console");
    }

    return (
        <PageShell className="max-w-7xl">
            <ExecutiveDashboardClient userEmail={session.user.email} />
        </PageShell>
    );
}
