import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppLayout } from "@/components/AppLayout";
import { NextAuthProvider } from "@/components/NextAuthProvider";
import { LiveChatWidget } from "@/components/LiveChatWidget";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

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
            <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans`}>
                <NextAuthProvider>
                    {children}
                    <LiveChatWidget />
                </NextAuthProvider>
            </body>
        </html>
    );
}
