import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ExecutiveDashboardClient } from "./ExecutiveDashboardClient";

export const metadata: Metadata = {
    title: "Admin portal – Monstera Cloud",
    description: "Incidents, support tickets, and finance for platform operators.",
};

export default async function AdminDashboardPage() {
    const session = await getServerSession(authOptions);
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

    // Check if user is logged in
    if (!session?.user?.email) {
        redirect("/login?callbackUrl=/admin");
    }

    // In production, check if admin email is set and matches
    if (
        process.env.NODE_ENV === "production" &&
        adminEmail &&
        session.user.email.trim().toLowerCase() !== adminEmail
    ) {
        redirect("/console");
    }

    return <ExecutiveDashboardClient userEmail={session.user.email} />;
}
