import type { Metadata } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Solutions for SMEs",
    description:
        "A verified reporting workflow for Southeast Asian marketing and commerce teams using certified sources, Google Sheets, and Looker Studio.",
    alternates: { canonical: `${PRODUCT_SITE_URL}/solutions/smes` },
    openGraph: {
        title: "Solutions for marketing and commerce teams",
        description: "Connect one certified source, verify its warehouse import, and report from a familiar destination.",
        url: `${PRODUCT_SITE_URL}/solutions/smes`,
    },
};

export default function SmesLayout({ children }: { children: React.ReactNode }) {
    return children;
}
