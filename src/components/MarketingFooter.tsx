import Link from "next/link";
import { LegalEntityNotice } from "./LegalEntityNotice";
import { Logo } from "./Logo";

const colTitle = "mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute";
const colLink = "text-[13px] text-ink-mute transition-colors duration-150 hover:text-ink";

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-canvas pt-16 pb-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4">
          <div>
            <h3 className={colTitle}>Product</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/docs#architecture" className={colLink}>
                  Overview
                </Link>
              </li>
              <li>
                <Link href="/pricing" className={colLink}>
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/templates" className={colLink}>
                  Templates
                </Link>
              </li>
              <li>
                <Link href="/docs#sources" className={colLink}>
                  Integrations
                </Link>
              </li>
              <li>
                <Link href="/docs" className={colLink}>
                  Docs
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className={colTitle}>Solutions</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/solutions/smes" className={colLink}>
                  For sellers
                </Link>
              </li>
              <li>
                <Link href="/solutions/agencies" className={colLink}>
                  For agencies
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className={colTitle}>Resources</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/docs" className={colLink}>
                  Docs
                </Link>
              </li>
              <li>
                <Link href="/changelog" className={colLink}>
                  Changelog
                </Link>
              </li>
              <li>
                <Link href="/support" className={colLink}>
                  Support
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className={colTitle}>Company</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/about" className={colLink}>
                  About
                </Link>
              </li>
              <li>
                <Link href="/legal/privacy-policy" className={colLink}>
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/legal/terms-of-service" className={colLink}>
                  Terms
                </Link>
              </li>
              <li>
                <Link href="/legal/refund-policy" className={colLink}>
                  Refunds
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <LegalEntityNotice className="mb-8 max-w-3xl text-xs leading-relaxed text-ink-mute" />
        <div className="flex flex-col items-start justify-between gap-4 border-t border-line pt-6 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <Logo className="h-6 w-6" textClassName="text-sm font-medium opacity-80" />
          </div>
          <p className="font-mono text-[11px] text-ink-mute">
            © {new Date().getFullYear()} Monstera Cloud · AES-256 · tenant isolated
          </p>
        </div>
      </div>
    </footer>
  );
}
