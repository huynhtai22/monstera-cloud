import Link from "next/link";
import { Logo } from "./Logo";
import { ArrowRight } from "lucide-react";

export function MarketingNavbar() {
    return (
        <nav className="fixed top-0 w-full z-50 bg-[#09090b]/80 backdrop-blur-md border-b border-white/10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    <div className="flex-shrink-0 flex items-center">
                        <Link href="/">
                            <Logo />
                        </Link>
                    </div>
                    <div className="hidden md:flex items-center space-x-8">
                        <Link href="/solutions/agencies" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Agencies
                        </Link>
                        <Link href="/templates" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Templates
                        </Link>
                        <Link href="/docs" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Docs
                        </Link>
                        <Link href="/pricing" className="text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Pricing
                        </Link>
                    </div>
                    <div className="flex items-center space-x-4">
                        <Link href="/api/auth/signin" className="hidden sm:block text-gray-400 hover:text-white text-sm font-medium transition-colors">
                            Log in
                        </Link>
                        <Link href="/dashboard" className="group inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm hover:shadow-md transition-all">
                            Start free trial
                            <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
            </div>
        </nav>
    );
}
