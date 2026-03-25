import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AppLayout } from "@/components/AppLayout";
import { NextAuthProvider } from "@/components/NextAuthProvider";
import { LiveChatWidget } from "@/components/LiveChatWidget";

const GTM_ID = "GTM-KMLZHNVV";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: {
      default: "Monstera Cloud | Effortless Data Integration",
      template: "%s | Monstera Cloud",
    },
    description: "Connect data, validate quality, and deliver insights without complex engineering setup. The modern data stack, simplified.",
    metadataBase: new URL("https://monsteracloud.com"),
    openGraph: {
      type: "website",
      locale: "en_US",
      url: "https://monsteracloud.com",
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
    return (
        <html lang="en" className="antialiased">
            <body className={inter.className}>
                {/* Google Tag Manager (noscript fallback for users with JS disabled) */}
                <noscript>
                    <iframe
                        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
                        height="0"
                        width="0"
                        style={{ display: "none", visibility: "hidden" }}
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

                <NextAuthProvider>
                    {children}
                    <LiveChatWidget />
                </NextAuthProvider>
            </body>
        </html>
    );
}
