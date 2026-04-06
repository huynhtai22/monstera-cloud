"use client";

import { useEffect, useState } from "react";
import { metaPixelPageView, metaPixelCustom, metaPixelIsReady } from "@/lib/meta-pixel";

/**
 * Visit /pixel-test — fires PageView + MC_Pixel_Test_Ping.
 * If Events Manager shows nothing: set NEXT_PUBLIC_META_TEST_EVENT_CODE (Test events tab),
 * disable ad blockers, try another browser, and confirm the pixel ID matches Events Manager.
 */
export default function PixelTestPage() {
    const [fbqStatus, setFbqStatus] = useState<"loading" | "ready" | "missing">("loading");

    useEffect(() => {
        metaPixelPageView();
        metaPixelCustom("MC_Pixel_Test_Ping", { source: "pixel_test_page" });
    }, []);

    useEffect(() => {
        const tick = () => {
            if (metaPixelIsReady()) {
                setFbqStatus("ready");
                return true;
            }
            return false;
        };
        if (tick()) return;
        const id = window.setInterval(() => {
            if (tick()) window.clearInterval(id);
        }, 100);
        const done = window.setTimeout(() => {
            window.clearInterval(id);
            setFbqStatus((s) => (s === "loading" ? "missing" : s));
        }, 12_000);
        return () => {
            window.clearInterval(id);
            window.clearTimeout(done);
        };
    }, []);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-[#09090b] text-zinc-300 text-sm max-w-lg mx-auto">
            <h1 className="text-lg font-semibold text-white mb-2">Meta Pixel test</h1>

            <p className="mb-4 text-center">
                <span className="text-zinc-500">fbq on page: </span>
                {fbqStatus === "loading" && <span className="text-amber-400">checking…</span>}
                {fbqStatus === "ready" && <span className="text-emerald-400">loaded</span>}
                {fbqStatus === "missing" && (
                    <span className="text-red-400">not detected (blocked or failed to load)</span>
                )}
            </p>

            <p className="text-emerald-400/90 mb-6 text-center">
                Queued an extra PageView + custom <code className="text-emerald-500">MC_Pixel_Test_Ping</code>{" "}
                (they send once <code className="text-emerald-500">fbq</code> is ready).
            </p>

            <ul className="text-zinc-500 text-left space-y-2 text-[13px] leading-relaxed list-disc pl-5">
                <li>
                    <strong className="text-zinc-400">Test events tab:</strong> In Events Manager → your pixel →{" "}
                    <strong>Test events</strong>, copy the <strong>test event code</strong> and set{" "}
                    <code className="text-zinc-400">NEXT_PUBLIC_META_TEST_EVENT_CODE</code> in Vercel (or{" "}
                    <code className="text-zinc-400">.env.local</code>), redeploy, then reload this page. Events
                    show up under Test events within ~1 minute.
                </li>
                <li>
                    <strong className="text-zinc-400">Pixel Helper:</strong> Install the &quot;Meta Pixel
                    Helper&quot; Chrome extension — it shows fires on the page even when the console lags.
                </li>
                <li>
                    <strong className="text-zinc-400">Ad blockers:</strong> Disable uBlock / Privacy Badger /
                    Brave shields for your domain.
                </li>
                <li>
                    <strong className="text-zinc-400">Wrong tab:</strong> “Overview” is delayed; use{" "}
                    <strong>Test events</strong> for instant debugging.
                </li>
            </ul>
        </div>
    );
}
