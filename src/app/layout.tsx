import type { Metadata } from "next";
// Use system font stack to avoid remote font fetch during build/deploy
import Script from "next/script";
import "./globals.css";
import { PRODUCT_SITE_URL } from "@/lib/site-url";
import { Providers } from "@/components/SWRProvider";
import { LiveChatWidget } from "@/components/LiveChatWidget";
import { MetaPixelAnalytics } from "@/components/MetaPixelAnalytics";

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID?.trim() || "GTM-KMLZHNVV";

/** Meta Pixel — override via NEXT_PUBLIC_META_PIXEL_ID in Vercel */
const META_PIXEL_ID =
    process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || "1678503466639816";

/** Paste from Events Manager → Test events → “Confirm your website events” — shows hits in Test events tab */
const META_TEST_EVENT_CODE = process.env.NEXT_PUBLIC_META_TEST_EVENT_CODE?.trim();
const FBQ_INIT_OPTIONS =
    META_TEST_EVENT_CODE && META_TEST_EVENT_CODE.length > 0
        ? `, ${JSON.stringify({ test_event_code: META_TEST_EVENT_CODE })}`
        : "";


export const metadata: Metadata = {
    title: {
      default: "Monstera Cloud | Effortless Data Integration",
      template: "%s | Monstera Cloud",
    },
    description: "Connect data, validate quality, and deliver insights without complex engineering setup. The modern data stack, simplified.",
    keywords: ["data integration", "ETL", "meta ads to google sheets", "tiktok ads to google sheets", "shopee reporting", "looker studio connector", "marketing dashboard"],
    metadataBase: new URL(PRODUCT_SITE_URL),
    openGraph: {
      type: "website",
      locale: "en_US",
      url: PRODUCT_SITE_URL,
      title: "Monstera Cloud | Effortless Data Integration",
      description: "Connect data, validate quality, and deliver insights without complex engineering setup.",
      siteName: "Monstera Cloud",
    },
    twitter: {
      card: "summary_large_image",
      title: "Monstera Cloud | Effortless Data Integration",
      description: "Connect data, validate quality, and deliver insights without complex engineering setup.",
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
      apple: "/favicon.svg",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "Monstera Cloud",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web",
        "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD"
        },
        "description": "Connect data, validate quality, and deliver insights without complex engineering setup.",
        "url": PRODUCT_SITE_URL
    };

    return (
        <html lang="en" className="antialiased">
            <head>
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
                />
            </head>
            <body className="antialiased">
                {/* Google Tag Manager (noscript fallback for users with JS disabled) */}
                <noscript>
                    <iframe
                        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
                        height="0"
                        width="0"
                        style={{ display: "none", visibility: "hidden" }}
                    />
                    <img
                        height="1"
                        width="1"
                        style={{ display: "none" }}
                        src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
                        alt=""
                    />
                </noscript>

                {/* Google Tag Manager — must be inside <body>, not <head>, in Next.js App Router */}
                <Script
                    id="gtm-script"
                    strategy="afterInteractive"
                    dangerouslySetInnerHTML={{
                        __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`,
                    }}
                />

                {/* Meta Pixel — beforeInteractive so fbq exists before client hydration (avoids dropped events) */}
                <Script
                    id="meta-pixel"
                    strategy="beforeInteractive"
                    dangerouslySetInnerHTML={{
                        __html: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}'${FBQ_INIT_OPTIONS});
fbq('track', 'PageView');`,
                    }}
                />

                <Providers>
                    {children}
                    <MetaPixelAnalytics />
                    <LiveChatWidget />
                </Providers>
            </body>
        </html>
    );
}
