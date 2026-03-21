import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";

export default function MarketingLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="dark bg-[#09090b] min-h-screen flex flex-col text-slate-200 selection:bg-emerald-500/30 font-sans">
            <MarketingNavbar />
            <main className="flex-1">
                {children}
            </main>
            <MarketingFooter />
        </div>
    );
}
