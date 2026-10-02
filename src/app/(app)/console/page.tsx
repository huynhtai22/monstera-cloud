import type { Metadata } from "next";
import { DashboardSessionGuard } from "@/components/dashboard/DashboardSessionGuard";

export const metadata: Metadata = {
    title: "Console",
    description: "Workspace dashboard — connections, sync health, and quick actions.",
};
export const dynamic = "force-dynamic";

export default function ConsolePage() {
    return <DashboardSessionGuard onboardingEnabled={process.env.ENABLE_AGENT_ONBOARDING === "1"} />;
}
