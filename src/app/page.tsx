import type { Metadata } from "next";
import MarketingHomePage from "@/components/marketing/MarketingHomePage";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Advertising data ready for Sheets and Looker Studio",
    description: "Connect certified Meta Ads, Google Ads, TikTok Ads, and Shopee workflows to a workspace-scoped reporting warehouse.",
    alternates: { canonical: PRODUCT_SITE_URL },
    openGraph: {
        title: "Advertising data ready for Sheets and Looker Studio",
        description: "Normalize certified advertising and marketplace data into a reporting warehouse your team can verify.",
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
