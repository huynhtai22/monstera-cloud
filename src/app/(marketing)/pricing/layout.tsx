import type { Metadata } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Pricing",
    description:
        "One flat price. Every platform. No row caps. Flat-rate plans for TikTok Ads, Shopee, and Google Sheets™ — USD and VND.",
    openGraph: {
        title: "Pricing | Monstera Cloud",
        description:
            "Most teams save vs legacy BI connectors. Free, Starter, and Pro — secure checkout via Paddle.",
        url: `${PRODUCT_SITE_URL}/pricing`,
    },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return children;
}
