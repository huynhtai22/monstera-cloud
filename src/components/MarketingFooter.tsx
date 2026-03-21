import Link from "next/link";
import { Logo } from "./Logo";

export function MarketingFooter() {
    return (
        <footer className="bg-white dark:bg-slate-950 border-t border-gray-200/50 dark:border-slate-800/50 pt-16 pb-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">Product</h3>
                        <ul className="space-y-3">
                            <li className="text-sm text-gray-400 dark:text-gray-600">Platform Overview <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li><Link href="/pricing" className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">Pricing</Link></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">Connectors <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">Security <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">Solutions</h3>
                        <ul className="space-y-3">
                            <li className="text-sm text-gray-400 dark:text-gray-600">For Marketing Agencies <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">For E-commerce <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">For Enterprises <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">Data Warehousing <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">Resources</h3>
                        <ul className="space-y-3">
                            <li className="text-sm text-gray-400 dark:text-gray-600">Blog <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">Documentation <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">Help Center <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">API Reference <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">Company</h3>
                        <ul className="space-y-3">
                            <li className="text-sm text-gray-400 dark:text-gray-600">About Us <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">Careers <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">Contact Sales <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                            <li className="text-sm text-gray-400 dark:text-gray-600">Partners <span className="text-[10px] ml-1 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Soon</span></li>
                        </ul>
                    </div>
                </div>
                <div className="border-t border-gray-200 dark:border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center">
                    <div className="flex items-center gap-2 mb-4 md:mb-0">
                        <Logo className="w-6 h-6 opacity-80" textClassName="text-sm font-semibold opacity-80" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            © {new Date().getFullYear()} Monstera Cloud Inc. All rights reserved.
                        </p>
                    </div>
                    <div className="flex space-x-6 mt-4 md:mt-0">
                        <Link href="/legal/privacy-policy" className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">Privacy Policy</Link>
                        <Link href="/legal/terms-of-service" className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">Terms of Service</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
