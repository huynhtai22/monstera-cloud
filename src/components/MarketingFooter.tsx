import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { LegalEntityNotice } from "./LegalEntityNotice";
import { Logo } from "./Logo";

export function MarketingFooter() {
    return (
        <footer className="bg-slate-50 border-t border-gray-200 pt-16 pb-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Product</h3>
                        <ul className="space-y-3">
                            <li><Link href="/docs#architecture" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Product Overview</Link></li>
                            <li><Link href="/pricing" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Pricing</Link></li>
                            <li><Link href="/templates" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Templates</Link></li>
                            <li><Link href="/docs#sources" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Integrations</Link></li>
                            <li><Link href="/docs" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Docs</Link></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Solutions</h3>
                        <ul className="space-y-3">
                            <li><Link href="/solutions/smes" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">For Sellers</Link></li>
                            <li><Link href="/solutions/agencies" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">For Agencies</Link></li>
                            <li><Link href="/pricing" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Pricing</Link></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Resources</h3>
                        <ul className="space-y-3">
                            <li><Link href="/docs" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Docs</Link></li>
                            <li><Link href="/templates" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Templates</Link></li>
                            <li><Link href="/docs#sources" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Integrations</Link></li>
                            <li><Link href="/changelog" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Product Updates</Link></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Company</h3>
                        <ul className="space-y-3">
                            <li><Link href="/about" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">About</Link></li>
                            <li><Link href="/support" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Contact</Link></li>
                            <li><Link href="/legal/privacy-policy" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Privacy Policy</Link></li>
                            <li><Link href="/legal/terms-of-service" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Terms</Link></li>
                        </ul>
                    </div>
                </div>
                <LegalEntityNotice className="text-xs text-slate-500 leading-relaxed max-w-3xl mb-8" />
                <div className="border-t border-gray-200 pt-8 flex flex-col md:flex-row justify-between items-center">
                    <div className="flex items-center gap-2 mb-4 md:mb-0">
                        <Logo className="w-6 h-6 opacity-80" textClassName="text-sm font-semibold opacity-80" />
                        <p className="text-sm text-slate-400">
                            © {new Date().getFullYear()} Monstera Cloud. All rights reserved.
                        </p>
                    </div>
                    <div className="flex space-x-6 mt-4 md:mt-0 items-center">
                        <Link href="/legal/privacy-policy" className="text-sm text-slate-400 hover:text-slate-700 transition-colors">Privacy Policy</Link>
                        <Link href="/legal/terms-of-service" className="text-sm text-slate-400 hover:text-slate-700 transition-colors">Terms of Service</Link>
                        <Link href="/legal/refund-policy" className="text-sm text-slate-400 hover:text-slate-700 transition-colors">Refund Policy</Link>
                        <Link href="/docs#security" className="text-xs text-cyan-600 font-medium hover:text-cyan-700 transition-colors flex items-center bg-cyan-50 px-2 py-1 rounded border border-cyan-200"><ShieldCheck className="w-3 h-3 mr-1"/> Vietnam PDPA Compliant</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
