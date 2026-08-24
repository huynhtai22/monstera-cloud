import type { Metadata } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Pricing and workspace plans",
    description:
        "Compare Monstera Cloud workspace capacity, reporting limits, and pilot pricing in USD or VND.",
    alternates: {
        canonical: `${PRODUCT_SITE_URL}/pricing`,
    },
    openGraph: {
        title: "Pricing and workspace plans",
        description:
            "Compare connections, seats, pipelines, reporting limits, and operator-managed private-pilot plans.",
        url: `${PRODUCT_SITE_URL}/pricing`,
    },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return children;
}
