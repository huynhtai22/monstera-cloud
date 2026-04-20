import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { OpsClient } from "./OpsClient";

export const metadata: Metadata = {
    title: "Ops Dashboard – Monstera Cloud",
    description: "Internal product operations dashboard.",
};

export default async function OpsPage() {
    const session = await getServerSession(authOptions);
    const adminEmail = process.env.ADMIN_EMAIL;

    // Fail-secure: if ADMIN_EMAIL is not set or user is not the admin, send to console.
    if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
        redirect("/console");
    }

    return <OpsClient />;
}
