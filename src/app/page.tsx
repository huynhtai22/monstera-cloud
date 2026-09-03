import type { Metadata } from "next";
import MarketingHomePage from "@/components/marketing/MarketingHomePage";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Performance reporting for agencies in Vietnam",
    description: "Give every agency client a separate reporting workspace for Meta Ads, Google Ads, TikTok Ads, and Shopee—with clean delivery to Sheets and Looker Studio.",
    alternates: { canonical: PRODUCT_SITE_URL },
    openGraph: {
        title: "More clients. Fewer hours spent reporting.",
        description: "Monitor spend, provider-reported revenue, ROAS, and data health in a workspace built for agency reporting.",
        url: PRODUCT_SITE_URL,
    },
};

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
