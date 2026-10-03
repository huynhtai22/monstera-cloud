"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function ConsoleSupportControl() {
    return <Link href="mailto:founders@monsteracloud.com?subject=Console Support" aria-label="Contact support" title="Contact support" className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-ink-mute hover:text-ink"><MessageCircle size={16} strokeWidth={1.5} /></Link>;
}

export function LiveChatWidget() {
    const pathname = usePathname();
    const [isVisible, setIsVisible] = useState(false);

    // Delay the appearance slightly so it doesn't distract immediately on load
    useEffect(() => {
        setIsVisible(false);
        const timer = setTimeout(() => setIsVisible(!document.querySelector("[data-console-theme]")), 1500);
        return () => clearTimeout(timer);
    }, [pathname]);

    if (!isVisible) return null;

    return (
        <div className="fixed bottom-5 right-5 z-30 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 duration-500">
            <Link 
                href="mailto:founders@monsteracloud.com?subject=Trial Inquiry / Support"
                aria-label="Contact support"
                className="group flex flex-col items-end"
            >
                {/* Tooltip bubble */}
                <div className="absolute bottom-[calc(100%+12px)] right-0 rounded-md border border-line bg-panel px-3 py-2 text-xs font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                    Need help? Talk to the founders
                </div>

                <div className="flex h-11 w-11 items-center justify-center rounded-md border border-line bg-panel text-ink hover:bg-white/[0.04]">
                    <MessageCircle className="h-5 w-5" strokeWidth={1.5} />
                </div>
            </Link>
        </div>
    );
}
