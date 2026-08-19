import React from "react";
import Link from "next/link";
import { Terminal, Database, BookOpen, Shield } from "lucide-react";

const SIDEBAR_LINKS = [
    {
        title: "Getting Started",
        icon: Terminal,
        links: [
            { label: "Introduction", href: "/docs" },
            { label: "Quickstart", href: "/docs#quickstart" },
            { label: "Architecture", href: "/docs#architecture" },
        ],
    },
    {
        title: "Integrations",
        icon: Database,
        links: [
            { label: "Supported Sources", href: "/docs#sources" },
            { label: "Destinations", href: "/docs#destinations" },
            { label: "Looker Studio connector", href: "/docs#looker-studio" },
            { label: "Synchronization", href: "/docs#sync" },
        ],
    },
    {
        title: "Core Concepts",
        icon: BookOpen,
        links: [
            { label: "Pipelines", href: "/docs#pipelines" },
            { label: "Workspaces", href: "/docs#workspaces" },
            { label: "Transformations", href: "/docs#transformations" },
        ],
    },
    {
        title: "Security & API",
        icon: Shield,
        links: [
            { label: "Authentication", href: "/docs#authentication" },
            { label: "API Reference", href: "/docs#api" },
            { label: "Rate Limits", href: "/docs#limits" },
        ],
    },
];

export default function DocsLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="flex min-h-screen bg-canvas font-sans text-ink-mute">
            <aside className="no-scrollbar sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 flex-col overflow-y-auto border-r border-line px-6 py-10 md:flex">
                <p className="mb-8 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">
                    Documentation
                </p>
                <div className="space-y-8">
                    {SIDEBAR_LINKS.map((section) => (
                        <div key={section.title}>
                            <h4 className="mb-3 flex items-center text-[13px] font-semibold text-ink">
                                <section.icon className="mr-2 h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} />
                                {section.title}
                            </h4>
                            <ul className="ml-2 space-y-1 border-l border-line pl-4">
                                {section.links.map((link) => (
                                    <li key={link.href}>
                                        <Link
                                            href={link.href}
                                            className="block py-1 text-[13px] text-ink-mute transition-colors duration-150 hover:text-ink"
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
            <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-8 md:py-16">{children}</main>
        </div>
    );
}
