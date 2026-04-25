import { logger } from "@/lib/logger";
/**
 * Client-only Meta Pixel helpers. fbq is injected by layout.tsx.
 * Event names use an MC_ prefix so custom conversions are easy to find in Events Manager.
 *
 * Next.js loads `next/script` afterInteractive — client code can run before `fbq` exists.
 * We queue calls until `window.fbq` is ready (same idea as Meta's stub).
 */

declare global {
    interface Window {
        fbq?: (...args: unknown[]) => void;
    }
}

const FBQ_WAIT_MS = 12_000;
const FBQ_POLL_MS = 50;

function runWhenFbqReady(fn: (fbq: NonNullable<Window["fbq"]>) => void): void {
    if (typeof window === "undefined") return;

    const run = () => {
        const fbq = window.fbq;
        if (typeof fbq === "function") {
            fn(fbq);
            return true;
        }
        return false;
    };

    if (run()) return;

    const started = Date.now();
    const id = window.setInterval(() => {
        if (run()) {
            window.clearInterval(id);
            return;
        }
        if (Date.now() - started >= FBQ_WAIT_MS) {
            window.clearInterval(id);
            if (process.env.NODE_ENV === "development") {
                logger.warn(
                    "[Meta Pixel] fbq never became available — ad blocker, CSP, or script order. Events were not sent."
                );
            }
        }
    }, FBQ_POLL_MS);
}

function callFbq(fn: (fbq: NonNullable<Window["fbq"]>) => void): void {
    runWhenFbqReady(fn);
}

/** True if fbq is callable right now (for diagnostics) */
export function metaPixelIsReady(): boolean {
    return typeof window !== "undefined" && typeof window.fbq === "function";
}

/** Standard PageView — use after client-side route changes */
export function metaPixelPageView(): void {
    callFbq((fbq) => fbq("track", "PageView"));
}

/** Custom events for Custom Conversions (exact string match in Events Manager) */
export function metaPixelCustom(
    eventName: string,
    params?: Record<string, string | number | boolean>
): void {
    callFbq((fbq) => fbq("trackCustom", eventName, params ?? {}));
}

/** Meta standard event — e.g. CompleteRegistration, InitiateCheckout */
export function metaPixelStandard(
    event: "CompleteRegistration" | "InitiateCheckout",
    params?: Record<string, unknown>
): void {
    callFbq((fbq) => fbq("track", event, params ?? {}));
}
