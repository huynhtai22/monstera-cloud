import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";

export default function MarketingLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-200 selection:bg-emerald-500/30">
            <MarketingNavbar />
            <main className="flex-1">
                {children}
            </main>
            <MarketingFooter />
        </div>
    );
}
