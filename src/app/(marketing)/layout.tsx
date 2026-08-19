import type { Metadata } from "next";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

const ogImage = `${PRODUCT_SITE_URL}/icon-512.png`;

export const metadata: Metadata = {
    title: {
        default: "Monstera Cloud | Client-Ready Reporting for Marketing Agencies",
        template: "%s | Monstera Cloud",
    },
    description:
        "Monstera Cloud gives marketing agencies one place to connect, normalize, and deliver client-ready reporting across Meta, Google Ads, TikTok, and Shopee.",
    openGraph: {
        type: "website",
        locale: "en_US",
        url: PRODUCT_SITE_URL,
        siteName: "Monstera Cloud",
        title: "Monstera Cloud | Client-Ready Reporting for Marketing Agencies",
        description:
            "Turn ad and marketplace data into client-ready Looker Studio and Google Sheets reports without spreadsheet cleanup.",
        images: [{ url: ogImage, width: 512, height: 512, alt: "Monstera Cloud" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "Monstera Cloud | Client-Ready Reporting for Marketing Agencies",
        description:
            "Turn ad and marketplace data into client-ready Looker Studio and Google Sheets reports without spreadsheet cleanup.",
        images: [ogImage],
    },
};

export default function MarketingLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="dark flex min-h-screen flex-col bg-canvas font-sans text-ink selection:bg-white/15">
            <MarketingNavbar />
            <main className="flex-1 pt-14">{children}</main>
            <MarketingFooter />
        </div>
    );
}
