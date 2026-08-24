"use client";

import Link from "next/link";
import { LegalEntityNotice } from "./LegalEntityNotice";
import { Logo } from "./Logo";

const colTitle = "mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-mute";
const colLink = "text-[13px] text-ink-mute transition-colors duration-150 hover:text-ink block";

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-canvas pt-16 pb-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 grid grid-cols-2 gap-8 md:grid-cols-4 lg:gap-12">
          {/* Column 1: Product */}
          <div>
            <h3 className={colTitle}>Product</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/platform" className={colLink}>
                  How Monstera Works
                </Link>
              </li>
              <li>
                <Link href="/integrations" className={colLink}>
                  Certified Integrations
                </Link>
              </li>
              <li>
                <Link href="/looker-studio" className={colLink}>
                  Looker Studio Connector
                </Link>
              </li>
              <li>
                <Link href="/templates" className={colLink}>
                  Workflow Examples
                </Link>
              </li>
              <li>
                <Link href="/pricing" className={colLink}>
                  Pricing &amp; Plans
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 2: Solutions */}
          <div>
            <h3 className={colTitle}>Solutions</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/solutions/agencies" className={colLink}>
                  For Marketing Agencies
                </Link>
              </li>
              <li>
                <Link href="/solutions/smes" className={colLink}>
                  For Performance Teams
                </Link>
              </li>
              <li>
                <Link href="/looker-studio" className={colLink}>
                  Looker Studio™ Integration
                </Link>
              </li>
              <li>
                <Link href="/platform" className={colLink}>
                  Product Architecture
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Resources & Docs */}
          <div>
            <h3 className={colTitle}>Resources</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/docs" className={colLink}>
                  Documentation
                </Link>
              </li>
              <li>
                <Link href="/docs#connect-source" className={colLink}>
                  Connect a Data Source
                </Link>
              </li>
              <li>
                <Link href="/changelog" className={colLink}>
                  Changelog &amp; Releases
                </Link>
              </li>
              <li>
                <Link href="/support" className={colLink}>
                  Help &amp; Support
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 4: Company & Legal */}
          <div>
            <h3 className={colTitle}>Legal &amp; Trust</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/about" className={colLink}>
                  About Monstera
                </Link>
              </li>
              <li>
                <Link href="/legal/privacy-policy" className={colLink}>
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/legal/terms-of-service" className={colLink}>
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/legal/refund-policy" className={colLink}>
                  Refund Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <LegalEntityNotice className="mb-8 max-w-3xl text-xs leading-relaxed text-ink-mute border-t border-line/60 pt-6" />

        {/* Bottom bar */}
        <div className="flex flex-col items-start justify-between gap-4 border-t border-line pt-6 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <Logo className="h-6 w-6" textClassName="text-sm font-medium opacity-90" />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-ink-mute">
            <span>© {new Date().getFullYear()} Monstera Cloud</span>
            <span>·</span>
            <span>AES-256-GCM credentials</span>
            <span>·</span>
            <span>Workspace-scoped data</span>
            <span>·</span>
            <span>HTTPS in transit</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
