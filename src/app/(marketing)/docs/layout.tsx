import React from "react";
import Link from "next/link";
import { Terminal, Database, BookOpen, Key, Zap, Settings, Shield } from "lucide-react";

const SIDEBAR_LINKS = [
    {
        title: "Getting Started",
        icon: Terminal,
        links: [
            { label: "Introduction", href: "/docs" },
            { label: "Quickstart", href: "/docs#quickstart" },
            { label: "Architecture", href: "/docs#architecture" },
        ]
    },
    {
        title: "Integrations",
        icon: Database,
        links: [
            { label: "Supported Sources", href: "/docs#sources" },
            { label: "Destinations", href: "/docs#destinations" },
            { label: "Synchronization", href: "/docs#sync" },
        ]
    },
    {
        title: "Core Concepts",
        icon: BookOpen,
        links: [
            { label: "Pipelines", href: "/docs#pipelines" },
            { label: "Workspaces", href: "/docs#workspaces" },
            { label: "Transformations", href: "/docs#transformations" },
        ]
    },
    {
        title: "Security & API",
        icon: Shield,
        links: [
            { label: "Authentication", href: "/docs#authentication" },
            { label: "API Reference", href: "/docs#api" },
            { label: "Rate Limits", href: "/docs#limits" },
        ]
    }
];

export default function DocsLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="min-h-screen bg-[#09090b] text-slate-300 pt-16 flex font-sans">
            
            {/* LEFT SIDEBAR (Desktop) */}
            <aside className="hidden md:flex flex-col w-72 border-r border-white/5 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto px-6 py-10 no-scrollbar">
                
                <div className="mb-8">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Documentation</p>
                </div>

                <div className="space-y-8">
                    {SIDEBAR_LINKS.map((section, idx) => (
                        <div key={idx}>
                            <h4 className="flex items-center text-sm font-semibold text-white mb-3">
                                <section.icon className="w-4 h-4 mr-2 text-gray-400" />
                                {section.title}
                            </h4>
                            <ul className="space-y-2 border-l border-white/10 ml-2 pl-4">
                                {section.links.map((link, jdx) => (
                                    <li key={jdx}>
                                        <Link 
                                            href={link.href} 
                                            className="text-sm text-gray-400 hover:text-emerald-500 transition-colors block py-1"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </aside>

            {/* MAIN CONTENT AREA */}
            <main className="flex-1 max-w-4xl px-4 sm:px-8 py-12 md:py-16 mx-auto w-full">
                {children}
            </main>

        </div>
    );
}
