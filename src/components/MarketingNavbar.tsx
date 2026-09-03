"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { readAppReturnPath } from "@/lib/app-return-path";
import { trackEvent } from "@/lib/analytics-events";
import { cn } from "@/lib/utils";

const MARKETING_LANG_KEY = "marketing_lang";
type Lang = "en" | "vi";

const NAV_LINKS = [
  { label: { en: "Product", vi: "Sản phẩm" }, href: "/platform" },
  { label: { en: "Integrations", vi: "Tích hợp" }, href: "/integrations" },
  { label: { en: "Pricing", vi: "Bảng giá" }, href: "/pricing" },
] as const;

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (next: Lang) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line bg-panel p-0.5" aria-label="Language">
      {(["en", "vi"] as Lang[]).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={lang === option}
          onClick={() => setLang(option)}
          className={cn(
            "px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider transition-colors duration-150",
            lang === option ? "bg-white/[0.08] font-semibold text-ink" : "text-ink-mute hover:text-ink",
          )}
        >
          {option}
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(MARKETING_LANG_KEY);
    if (saved === "en" || saved === "vi") setLang(saved);
  }, []);

  useEffect(() => {
    setConsoleHref(readAppReturnPath());
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 16);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const onSetLang = (nextLang: Lang) => {
    setLang(nextLang);
    window.localStorage.setItem(MARKETING_LANG_KEY, nextLang);
    window.dispatchEvent(new CustomEvent("marketing-lang-change", { detail: nextLang }));
  };

  return (
    <nav
      className={cn(
        "fixed top-0 z-50 h-14 w-full border-b backdrop-blur-md transition-colors duration-200",
        isScrolled ? "border-line/90 bg-canvas/95 shadow-xs" : "border-line/70 bg-canvas/80",
      )}
      aria-label="Primary navigation"
    >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" title="Monstera Cloud — Home" className="flex shrink-0 items-center">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((item) => {
            const current = isCurrentPath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
                  current ? "bg-white/[0.055] text-ink" : "text-ink-mute hover:bg-white/[0.03] hover:text-ink",
                )}
              >
                {item.label[lang]}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          {showLangToggle ? (
            <div className="hidden sm:block">
              <LangToggle lang={lang} setLang={onSetLang} />
            </div>
          ) : null}

          {isAuthed ? (
            <Link href={consoleHref} className="inline-flex items-center rounded-md border border-line bg-panel px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-white/[0.04]">
              {lang === "vi" ? "Bảng điều khiển" : "Console"}
            </Link>
          ) : (
            <Link href="/login" className="hidden text-[13px] font-medium text-ink-mute transition-colors hover:text-ink sm:block">
              {lang === "vi" ? "Đăng nhập" : "Log in"}
            </Link>
          )}

          {!isAuthed ? (
            <Link
              href="/register?offer=agency-pro-pilot"
              onClick={() => trackEvent("landing_pilot_cta_clicked", { location: "navbar", language: lang, offer: "agency_pro_7_day" })}
              className="inline-flex items-center justify-center rounded-md bg-white px-3.5 py-1.5 text-[13px] font-semibold text-neutral-950 shadow-xs transition-colors hover:bg-neutral-200"
            >
              {lang === "vi" ? "Dùng thử 7 ngày" : "7-day pilot"}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          ) : null}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-ink-mute transition-colors hover:text-ink md:hidden"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="marketing-mobile-menu"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div id="marketing-mobile-menu" className="border-b border-line bg-panel/98 px-4 py-4 shadow-xl backdrop-blur-md md:hidden">
          <div className="mx-auto max-w-6xl">
            {showLangToggle ? (
              <div className="mb-3 flex items-center justify-between border-b border-line pb-3 sm:hidden">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">{lang === "vi" ? "Ngôn ngữ" : "Language"}</span>
                <LangToggle lang={lang} setLang={onSetLang} />
              </div>
            ) : null}

            <div className="grid gap-1">
              {NAV_LINKS.map((item) => {
                const current = isCurrentPath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                      current ? "bg-white/[0.055] text-ink" : "text-ink-mute hover:bg-white/[0.03] hover:text-ink",
                    )}
                  >
                      {item.label[lang]}
                    {current ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
                  </Link>
                );
              })}
            </div>

            {!isAuthed ? (
              <Link href="/login" className="mt-3 block border-t border-line px-3 pt-3 text-sm font-medium text-ink-mute sm:hidden">
                {lang === "vi" ? "Đăng nhập" : "Log in"}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
