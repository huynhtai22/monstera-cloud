import type { Metadata } from "next";
import { DashboardSessionGuard } from "@/components/dashboard/DashboardSessionGuard";

export const metadata: Metadata = {
    title: "Console",
    description: "Workspace dashboard — connections, sync health, and quick actions.",
};

export default function ConsolePage() {
    return <DashboardSessionGuard />;
}
