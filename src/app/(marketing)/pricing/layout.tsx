import type { Metadata } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Pricing",
    description:
        "Agency Pro pricing for Monstera Cloud, with a seven-day pilot and a neutral Enterprise contact option.",
    openGraph: {
        title: "Pricing | Monstera Cloud",
        description:
            "Start a seven-day Agency Pro pilot, then continue monthly or annually through verified PayOS checkout.",
        url: `${PRODUCT_SITE_URL}/pricing`,
    },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return children;
}
