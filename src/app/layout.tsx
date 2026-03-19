import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppLayout } from "@/components/AppLayout";
import { NextAuthProvider } from "@/components/NextAuthProvider";

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
      icon: "/favicon.png",
      shortcut: "/favicon.png",
      apple: "/favicon.png",
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
                <NextAuthProvider>
                    {children}
                </NextAuthProvider>
            </body>
        </html>
    );
}
