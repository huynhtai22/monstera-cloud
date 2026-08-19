"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { ArrowRight } from "lucide-react";
import { readAppReturnPath } from "@/lib/app-return-path";

const MARKETING_LANG_KEY = "marketing_lang";

type Lang = "en" | "vi";

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line bg-panel p-0.5">
      {(["en", "vi"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`px-2.5 py-1 font-mono text-[10px] font-medium tracking-wider uppercase transition-colors duration-150 ${
            lang === l ? "bg-white/[0.08] text-ink" : "text-ink-mute hover:text-ink"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

const navLink =
  "text-[13px] text-ink-mute transition-colors duration-150 hover:text-ink";

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
    <nav className="fixed top-0 z-50 w-full border-b border-line/80 bg-canvas/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" title="Monstera — home" className="shrink-0">
          <Logo />
        </Link>
        <div className="hidden items-center gap-7 md:flex">
          <Link href="/solutions/agencies" className={navLink}>
            Agencies
          </Link>
          <Link href="/docs" className={navLink}>
            Docs
          </Link>
          <Link href="/pricing" className={navLink}>
            Pricing
          </Link>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {showLangToggle ? <LangToggle lang={lang} setLang={onSetLang} /> : null}
          {isAuthed ? (
            <Link
              href={consoleHref}
              className="inline-flex items-center gap-1.5 text-[13px] text-ink-mute transition-colors duration-150 hover:text-ink"
            >
              Console
            </Link>
          ) : (
            <Link href="/login" className={`hidden sm:block ${navLink}`}>
              Log in
            </Link>
          )}
          {isAuthed ? null : (
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary-hover"
            >
              Start pilot
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
