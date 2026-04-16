import type { Metadata } from "next";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

const ogImage = `${PRODUCT_SITE_URL}/favicon.svg`;

export const metadata: Metadata = {
    title: {
        default: "Monstera Cloud | E-commerce data in Google Sheets™",
        template: "%s | Monstera Cloud",
    },
    description:
        "Connect TikTok Ads, Meta, Shopee, and Google Ads. Pull performance into Google Sheets™ automatically — built for Southeast Asia.",
    openGraph: {
        type: "website",
        locale: "en_US",
        url: PRODUCT_SITE_URL,
        siteName: "Monstera Cloud",
        title: "Monstera Cloud | E-commerce data in Google Sheets™",
        description:
            "Stop reconciling spreadsheets at midnight. One workspace for TikTok, Meta, Shopee, and Google Ads.",
        images: [{ url: ogImage, width: 512, height: 512, alt: "Monstera Cloud" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "Monstera Cloud | E-commerce data in Google Sheets™",
        description:
            "Connect TikTok Ads, Meta, Shopee, and Google Ads. Pull performance into Google Sheets™ automatically.",
        images: [ogImage],
    },
};

export default function MarketingLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="dark bg-[#09090b] min-h-screen flex flex-col text-slate-200 selection:bg-cyan-500/30 font-sans">
            <MarketingNavbar />
            <main className="flex-1">{children}</main>
            <MarketingFooter />
        </div>
    );
}
