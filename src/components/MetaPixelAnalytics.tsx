"use client";

import { Suspense } from "react";
import { MetaPixelRouteTracker } from "./MetaPixelRouteTracker";

/** Suspense boundary required for useSearchParams in the route tracker */
export function MetaPixelAnalytics() {
    return (
        <Suspense fallback={null}>
            <MetaPixelRouteTracker />
        </Suspense>
    );
}
