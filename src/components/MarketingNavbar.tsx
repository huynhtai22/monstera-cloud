"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import {
  ArrowRight,
  ChevronDown,
  DatabaseZap,
  Database,
  Download,
  LayoutTemplate,
  Users,
  TrendingUp,
  Menu,
  X,
} from "lucide-react";
import { readAppReturnPath } from "@/lib/app-return-path";
import { cn } from "@/lib/utils";

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
          className={cn(
            "px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider transition-colors duration-150",
            lang === l ? "bg-white/[0.08] text-ink font-semibold" : "text-ink-mute hover:text-ink"
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

const PRODUCT_LINKS = [
  {
    name: "Sources & Connectors",
    description: "Connect Meta, Google Ads, TikTok, and Shopee via read-only OAuth.",
    href: "/sources",
    icon: DatabaseZap,
  },
  {
    name: "Unified Warehouse",
    description: "Normalized multi-channel metrics stored in isolated PostgreSQL tables.",
    href: "/explorer",
    icon: Database,
  },
  {
    name: "Exports & API",
    description: "Live Looker Studio, Google Sheets, and programmatic REST API delivery.",
    href: "/exports",
    icon: Download,
  },
  {
    name: "Dashboard Templates",
    description: "Pre-built agency client reporting templates and KPI decks.",
    href: "/templates",
    icon: LayoutTemplate,
  },
];

const SOLUTIONS_LINKS = [
  {
    name: "For Marketing Agencies",
    description: "Multi-client workspace isolation and automated client reporting standups.",
    href: "/solutions/agencies",
    icon: Users,
  },
  {
    name: "For Performance Teams",
    description: "Cross-channel spend reconciliation, ROAS tracking, and zero spreadsheet glue.",
    href: "/solutions/smes",
    icon: TrendingUp,
  },
];

export function MarketingNavbar() {
  const { status } = useSession();
  const pathname = usePathname();
  const isAuthed = status === "authenticated";
  const showLangToggle = pathname === "/" || pathname === "/solutions/smes";
  const [lang, setLang] = useState<Lang>("en");
  const [consoleHref, setConsoleHref] = useState("/console");
  const [activeDropdown, setActiveDropdown] = useState<"product" | "solutions" | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const navRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 16);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setActiveDropdown(null);
    setMobileMenuOpen(false);
  }, [pathname]);

  const onSetLang = (nextLang: Lang) => {
    setLang(nextLang);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MARKETING_LANG_KEY, nextLang);
      window.dispatchEvent(new CustomEvent("marketing-lang-change", { detail: nextLang }));
    }
  };

  return (
    <nav
      ref={navRef}
      className={cn(
        "fixed top-0 z-50 w-full border-b border-line/80 bg-canvas/80 backdrop-blur-md transition-all duration-200",
        isScrolled ? "h-13 border-line/90 shadow-xs" : "h-14"
      )}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Logo */}
        <Link href="/" title="Monstera Cloud — Home" className="flex items-center shrink-0">
          <Logo />
        </Link>

        {/* Center: Desktop Navigation */}
        <div className="hidden items-center gap-6 md:flex">
          {/* Product Dropdown */}
          <div
            className="relative"
            onMouseEnter={() => setActiveDropdown("product")}
            onMouseLeave={() => setActiveDropdown(null)}
          >
            <button
              type="button"
              onClick={() => setActiveDropdown(activeDropdown === "product" ? null : "product")}
              className={cn(
                "inline-flex items-center gap-1 text-[13px] font-medium transition-colors duration-150",
                activeDropdown === "product" ? "text-ink" : "text-ink-mute hover:text-ink"
              )}
            >
              Product
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-ink-mute transition-transform duration-150",
                  activeDropdown === "product" && "rotate-180 text-ink"
                )}
              />
            </button>

            {activeDropdown === "product" && (
              <div className="absolute left-1/2 top-full -translate-x-1/2 pt-2 animate-in fade-in-0 duration-150">
                <div className="w-[360px] rounded-lg border border-line bg-panel p-2 shadow-xl">
                  <div className="space-y-1">
                    {PRODUCT_LINKS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          className="flex items-start gap-3 rounded-md p-2.5 transition-colors hover:bg-white/[0.04]"
                        >
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-ink">
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <div className="text-[13px] font-medium text-ink">{item.name}</div>
                            <div className="text-xs leading-snug text-ink-mute mt-0.5">
                              {item.description}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Solutions Dropdown */}
          <div
            className="relative"
            onMouseEnter={() => setActiveDropdown("solutions")}
            onMouseLeave={() => setActiveDropdown(null)}
          >
            <button
              type="button"
              onClick={() => setActiveDropdown(activeDropdown === "solutions" ? null : "solutions")}
              className={cn(
                "inline-flex items-center gap-1 text-[13px] font-medium transition-colors duration-150",
                activeDropdown === "solutions" ? "text-ink" : "text-ink-mute hover:text-ink"
              )}
            >
              Solutions
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-ink-mute transition-transform duration-150",
                  activeDropdown === "solutions" && "rotate-180 text-ink"
                )}
              />
            </button>

            {activeDropdown === "solutions" && (
              <div className="absolute left-1/2 top-full -translate-x-1/2 pt-2 animate-in fade-in-0 duration-150">
                <div className="w-[340px] rounded-lg border border-line bg-panel p-2 shadow-xl">
                  <div className="space-y-1">
                    {SOLUTIONS_LINKS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          className="flex items-start gap-3 rounded-md p-2.5 transition-colors hover:bg-white/[0.04]"
                        >
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-ink">
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <div className="text-[13px] font-medium text-ink">{item.name}</div>
                            <div className="text-xs leading-snug text-ink-mute mt-0.5">
                              {item.description}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <Link
            href="/pricing"
            className="text-[13px] font-medium text-ink-mute transition-colors duration-150 hover:text-ink"
          >
            Pricing
          </Link>
          <Link
            href="/docs"
            className="text-[13px] font-medium text-ink-mute transition-colors duration-150 hover:text-ink"
          >
            Docs
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 sm:gap-4">
          {showLangToggle && <LangToggle lang={lang} setLang={onSetLang} />}

          {isAuthed ? (
            <Link
              href={consoleHref}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-white/[0.04]"
            >
              Console
            </Link>
          ) : (
            <Link
              href="/login"
              className="hidden text-[13px] font-medium text-ink-mute transition-colors duration-150 hover:text-ink sm:block"
            >
              Log in
            </Link>
          )}

          {!isAuthed && (
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-white px-3.5 py-1.5 text-[13px] font-semibold text-neutral-950 shadow-xs transition-colors hover:bg-neutral-200"
            >
              Start pilot
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          )}

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-ink-mute hover:text-ink md:hidden"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Panel */}
      {mobileMenuOpen && (
        <div className="border-b border-line bg-panel px-4 py-5 md:hidden">
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">Product</p>
              {PRODUCT_LINKS.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className="block py-1 text-[13px] text-ink hover:text-white"
                >
                  {item.name}
                </Link>
              ))}
            </div>

            <div className="space-y-2 border-t border-line pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">Solutions</p>
              {SOLUTIONS_LINKS.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className="block py-1 text-[13px] text-ink hover:text-white"
                >
                  {item.name}
                </Link>
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <Link href="/pricing" className="py-1 text-[13px] text-ink">
                Pricing
              </Link>
              <Link href="/docs" className="py-1 text-[13px] text-ink">
                Docs
              </Link>
              {!isAuthed && (
                <Link href="/login" className="py-1 text-[13px] text-ink-mute">
                  Log in
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
