import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { DashboardHomePage } from "@/components/dashboard/DashboardHomePage";
import MarketingHomePage from "@/components/marketing/MarketingHomePage";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";

export default async function Home() {
    const session = await getServerSession(authOptions);

    if (session?.user) {
        return (
            <AppLayout>
                <DashboardHomePage />
            </AppLayout>
        );
    }

    return (
        <div className="dark flex min-h-screen flex-col bg-[#09090b] font-sans text-slate-200 selection:bg-cyan-500/30">
            <MarketingNavbar />
            <main className="flex-1">
                <MarketingHomePage />
            </main>
            <MarketingFooter />
        </div>
    );
}
