"use client";

import { useEffect, useState } from "react";
import { SWRConfig } from "swr";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

const providers = [
  { id: "meta_ads", name: "Meta Ads", logoSrc: INTEGRATION_LOGOS.meta, description: "Ad reporting" },
  { id: "google_ads", name: "Google Ads", logoSrc: INTEGRATION_LOGOS.googleAds, description: "Ad reporting" },
  { id: "shopee", name: "Shopee", logoSrc: INTEGRATION_LOGOS.shopee, description: "Shop reporting" },
  { id: "shopify", name: "Shopify", logoSrc: INTEGRATION_LOGOS.shopify, description: "Store reporting" },
];
const previewCache = () => new Map();

export default function ConnectorPreview() {
  const [selected, setSelected] = useState<(typeof providers)[number] | null>(providers[0]);
  const [open, setOpen] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => {
    const previous = document.documentElement.dataset.consoleTheme;
    document.documentElement.dataset.consoleTheme = light ? "light" : "dark";
    return () => {
      if (previous) document.documentElement.dataset.consoleTheme = previous;
      else delete document.documentElement.dataset.consoleTheme;
    };
  }, [light]);
  return <SWRConfig value={{ provider: previewCache, isPaused: () => true, revalidateOnMount: false, fallback: { "/api/integrations/config": { metaConfigured: true, googleAdsConfigured: true, shopeeConfigured: true, shopifyConfigured: true } } }}>
    <main className="min-h-screen bg-canvas p-8 text-ink">
      <h1 className="text-2xl">Connector panel preview</h1>
      <p className="mt-3 text-sm text-ink-mute">Shared production component. Sample preview — no sign-in, import or account changes.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {providers.map(provider => <button key={provider.id} className="rounded-lg border border-line px-4 py-3" onClick={() => { setSelected(provider); setOpen(true); }}>Preview {provider.name}</button>)}
        <button className="rounded-lg border border-line px-4 py-3" onClick={() => setLight(!light)}>{light ? "Dark mode" : "Light mode"}</button>
      </div>
      <ConnectSourceModal isOpen={open} onClose={() => setOpen(false)} integration={selected} previewMode />
    </main>
  </SWRConfig>;
}
