"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function LiveChatWidget() {
    const [isVisible, setIsVisible] = useState(false);

    // Delay the appearance slightly so it doesn't distract immediately on load
    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), 1500);
        return () => clearTimeout(timer);
    }, []);

    if (!isVisible) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] animate-in fade-in slide-in-from-bottom-5 duration-500">
            <Link 
                href="mailto:founders@monsteracloud.com?subject=Trial Inquiry / Support"
                className="group flex flex-col items-end"
            >
                {/* Tooltip bubble */}
                <div className="absolute bottom-[calc(100%+12px)] right-0 bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold py-2 px-4 rounded-xl shadow-xl opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all origin-bottom-right whitespace-nowrap pointer-events-none">
                    Need help? Talk to the founders
                    <div className="absolute -bottom-1.5 right-6 w-3 h-3 bg-slate-900 dark:bg-slate-800 rotate-45"></div>
                </div>

                {/* Floating Button */}
                <div className="w-14 h-14 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-[0_8px_30px_rgb(5,150,105,0.4)] transition-all hover:scale-110 active:scale-95">
                    <MessageCircle className="w-6 h-6" />
                </div>
            </Link>
        </div>
    );
}
