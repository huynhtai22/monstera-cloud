import type { Metadata } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Looker Studio",
    description:
        "Send Monstera data to Looker Studio for dashboards and reports alongside Google Sheets™.",
    openGraph: {
        title: "Looker Studio | Monstera Cloud",
        url: `${PRODUCT_SITE_URL}/looker-studio`,
    },
};

export default function LookerStudioMarketingLayout({ children }: { children: React.ReactNode }) {
    return children;
}
