import type { Metadata } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Console",
    description:
        "Connect data sources, manage pipelines, and sync e-commerce and ad data to Google Sheets™ and destinations.",
    robots: { index: false, follow: false },
    openGraph: {
        title: "Console | Monstera Cloud",
        url: `${PRODUCT_SITE_URL}/console`,
    },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
    return children;
}
