"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { metaPixelPageView } from "@/lib/meta-pixel";

/**
 * Fires PageView on client-side navigations. Initial load is covered by layout.tsx.
 */
export function MetaPixelRouteTracker() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const query = searchParams?.toString() ?? "";
    const skipFirst = useRef(true);

    useEffect(() => {
        if (skipFirst.current) {
            skipFirst.current = false;
            return;
        }
        metaPixelPageView();
    }, [pathname, query]);

    return null;
}
