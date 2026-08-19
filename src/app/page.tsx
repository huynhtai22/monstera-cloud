import MarketingHomePage from "@/components/marketing/MarketingHomePage";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";

export default function Home() {
    return (
        <div className="dark flex min-h-screen flex-col bg-canvas font-sans text-ink selection:bg-white/15">
            <MarketingNavbar />
            <main className="flex-1 pt-14">
                <MarketingHomePage />
            </main>
            <MarketingFooter />
        </div>
    );
}
