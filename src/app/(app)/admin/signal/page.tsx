import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignalDeskClient } from "./SignalDeskClient";

export const metadata: Metadata = {
  title: "Signal Desk – Monstera Cloud",
  description: "Internal autonomous content intelligence & research desk.",
};

export default async function SignalDeskPage() {
  const session = await getServerSession(authOptions);
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

  // Fail-secure: if ADMIN_EMAIL is not configured or user is not the admin, redirect to /console.
  if (
    !session?.user?.email ||
    !adminEmail ||
    session.user.email.trim().toLowerCase() !== adminEmail
  ) {
    redirect("/console");
  }

  return <SignalDeskClient userEmail={session.user.email} />;
}
