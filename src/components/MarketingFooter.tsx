import Link from "next/link";
import { Logo } from "./Logo";

export function MarketingFooter() {
    return (
        <footer className="bg-[#000000] border-t border-white/10 pt-16 pb-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                    <div>
                        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Product</h3>
                        <ul className="space-y-3">
                            <li className="text-sm text-gray-500">Platform Overview <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li><Link href="/pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Pricing</Link></li>
                            <li className="text-sm text-gray-500">Connectors <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">Security <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Solutions</h3>
                        <ul className="space-y-3">
                            <li className="text-sm text-gray-500">For Marketing Agencies <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">For E-commerce <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">For Enterprises <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">Data Warehousing <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Resources</h3>
                        <ul className="space-y-3">
                            <li className="text-sm text-gray-500">Blog <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">Documentation <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">Help Center <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">API Reference <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Company</h3>
                        <ul className="space-y-3">
                            <li className="text-sm text-gray-500">About Us <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">Careers <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">Contact Sales <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                            <li className="text-sm text-gray-500">Partners <span className="text-[10px] ml-1 bg-white/10 px-1.5 py-0.5 rounded text-white">Soon</span></li>
                        </ul>
                    </div>
                </div>
                <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center">
                    <div className="flex items-center gap-2 mb-4 md:mb-0">
                        <Logo className="w-6 h-6 opacity-80" textClassName="text-sm font-semibold opacity-80" />
                        <p className="text-sm text-gray-400">
                            © {new Date().getFullYear()} Monstera Cloud Inc. All rights reserved.
                        </p>
                    </div>
                    <div className="flex space-x-6 mt-4 md:mt-0">
                        <Link href="/legal/privacy-policy" className="text-sm text-gray-400 hover:text-white transition-colors">Privacy Policy</Link>
                        <Link href="/legal/terms-of-service" className="text-sm text-gray-400 hover:text-white transition-colors">Terms of Service</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
