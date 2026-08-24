import type { Metadata } from "next";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

const ogImage = `${PRODUCT_SITE_URL}/icon-512.png`;

export const metadata: Metadata = {
    description:
        "Connect Meta, Google Ads, TikTok, and Shopee. Monstera normalizes marketing data and keeps it ready for reporting workflows.",
    openGraph: {
        type: "website",
        locale: "en_US",
        url: PRODUCT_SITE_URL,
        siteName: "Monstera Cloud",
        title: "Monstera Cloud | Your Ad Data, Ready to Report",
        description:
            "Connect marketing platforms, normalize data, and keep reporting workflows ready.",
        images: [{ url: ogImage, width: 512, height: 512, alt: "Monstera Cloud" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "Monstera Cloud | Your Ad Data, Ready to Report",
        description:
            "Connect marketing platforms, normalize data, and keep reporting workflows ready.",
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
