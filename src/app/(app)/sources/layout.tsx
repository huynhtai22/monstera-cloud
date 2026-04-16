import type { Metadata } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Sources",
    description:
        "Connect data sources, manage pipelines, and sync e-commerce and ad data to Google Sheets™ and destinations.",
    robots: { index: false, follow: false },
    openGraph: {
        title: "Sources | Monstera Cloud",
        url: `${PRODUCT_SITE_URL}/sources`,
    },
};

export default function SourcesLayout({ children }: { children: React.ReactNode }) {
    return children;
}
