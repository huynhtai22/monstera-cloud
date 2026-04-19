"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { ArrowRight, SquareTerminal } from "lucide-react";
import { readAppReturnPath } from "@/lib/app-return-path";

const MARKETING_LANG_KEY = "marketing_lang";

type Lang = "en" | "vi";

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
    return (
        <div className="inline-flex rounded-full border border-white/10 overflow-hidden bg-white/[0.03] p-0.5">
            {(["en", "vi"] as Lang[]).map((l) => (
                <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition-all duration-200 ${
                        lang === l
                            ? "bg-white/10 text-white shadow-sm"
                            : "text-gray-500 hover:text-gray-300"
                    }`}
                >
                    {l.toUpperCase()}
                </button>
            ))}
        </div>
    );
}

export function MarketingNavbar() {
    const { status } = useSession();
    const pathname = usePathname();
    const isAuthed = status === "authenticated";
    const showLangToggle = pathname === "/" || pathname === "/solutions/smes";
    const [lang, setLang] = useState<Lang>("en");
    const [consoleHref, setConsoleHref] = useState("/console");

    useEffect(() => {
        if (typeof window === "undefined") return;
        const saved = window.localStorage.getItem(MARKETING_LANG_KEY);
        if (saved === "en" || saved === "vi") {
            setLang(saved);
        }
    }, []);

    useEffect(() => {
        setConsoleHref(readAppReturnPath());
    }, [pathname]);

    const onSetLang = (nextLang: Lang) => {
        setLang(nextLang);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(MARKETING_LANG_KEY, nextLang);
            window.dispatchEvent(new CustomEvent("marketing-lang-change", { detail: nextLang }));
        }
    };

    return (
        <nav className="fixed top-0 w-full z-50 bg-[#09090b]/80 backdrop-blur-md border-b border-white/10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    <div className="flex-shrink-0 flex items-center">
                        <Link href="/" title="Monstera — home">
                            <Logo />
                        </Link>
                    </div>
                    <div className="hidden md:flex items-center space-x-8">
                        <Link href="/solutions/smes" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            For SMEs
                        </Link>
<Link href="/docs" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Docs
                        </Link>
                        <Link href="/showcase" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Showcase
                        </Link>
                        <Link href="/looker-studio" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Looker Studio
                        </Link>
                        <Link href="/pricing" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Pricing
                        </Link>
                    </div>
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        <Link
                            href="/id"
                            className="hidden text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-300 sm:block"
                        >
                            ID
                        </Link>
                        {showLangToggle ? <LangToggle lang={lang} setLang={onSetLang} /> : null}
                        {isAuthed ? (
                            <Link
                                href={consoleHref}
                                className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 text-sm font-medium transition-colors"
                            >
                                <SquareTerminal className="w-4 h-4" />
                                Console
                            </Link>
                        ) : (
                            <Link href="/login" className="hidden sm:block text-gray-400 hover:text-white text-sm font-medium transition-colors">
                                Log in
                            </Link>
                        )}
                        {isAuthed ? null : (
                            <Link href="/register" className="group inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg shadow-sm hover:shadow-md transition-all">
                                Start free trial
                                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </nav>
    );
}
