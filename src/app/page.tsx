import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import MarketingHomePage from "@/components/marketing/MarketingHomePage";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";

export default async function Home() {
    const session = await getServerSession(authOptions);

    if (session?.user) {
        redirect("/console");
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
