import type { Metadata } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Solutions for SMEs",
    description:
        "Monstera Cloud for small and mid-size e-commerce teams in Southeast Asia — connect ads and marketplaces to Google Sheets™.",
    openGraph: {
        title: "Solutions for SMEs | Monstera Cloud",
        url: `${PRODUCT_SITE_URL}/solutions/smes`,
    },
};

export default function SmesLayout({ children }: { children: React.ReactNode }) {
    return children;
}
