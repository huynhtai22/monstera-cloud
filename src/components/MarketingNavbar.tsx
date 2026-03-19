import Link from "next/link";
import NextImage from "next/image";
import { ArrowRight } from "lucide-react";

export function MarketingNavbar() {
    return (
        <nav className="fixed top-0 w-full z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-gray-200/50 dark:border-slate-800/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    <div className="flex-shrink-0 flex items-center">
                        <Link href="/" className="flex items-center gap-2 font-bold text-xl text-gray-900 dark:text-white">
                            <NextImage 
                                src="/logo.png" 
                                alt="Monstera Cloud Logo" 
                                width={32} 
                                height={32} 
                                className="w-8 h-8 rounded-full shadow-sm"
                            />
                            <span>Monstera</span>
                        </Link>
                    </div>
                    <div className="hidden md:flex items-center space-x-8">
                        <Link href="/platform" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white text-sm font-medium transition-colors">
                            Platform
                        </Link>
                        <Link href="/solutions" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white text-sm font-medium transition-colors">
                            Solutions
                        </Link>
                        <Link href="/pricing" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white text-sm font-medium transition-colors">
                            Pricing
                        </Link>
                    </div>
                    <div className="flex items-center space-x-4">
                        <Link href="/api/auth/signin" className="hidden sm:block text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white text-sm font-medium transition-colors">
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
