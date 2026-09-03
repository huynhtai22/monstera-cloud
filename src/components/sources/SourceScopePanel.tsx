"use client";

import { CopyableBadge } from "@/components/ui/CopyableBadge";
import { AccountSelector } from "@/components/sources/AccountSelector";
import { SourceReconnectBanner } from "@/components/sources/SourceReconnectBanner";
import {
  PROVIDER_DISPLAY_NAME,
  isMultiAccountProvider,
  summarizeAccountScope,
} from "@/lib/source-list-display";

export function SourceScopePanel({
  connectionId,
  provider,
  connectionName,
  managerBadge,
  accountEmail,
  needsReconnect,
  onReconnect,
}: {
  connectionId: string;
  provider: string;
  connectionName?: string;
  managerBadge?: string | null;
  accountEmail?: string | null;
  needsReconnect?: boolean;
  onReconnect?: () => void;
}) {
  if (isMultiAccountProvider(provider)) {
    return (
      <AccountSelector
        connectionId={connectionId}
        provider={provider}
        connectionName={connectionName}
        managerBadge={managerBadge}
        accountEmail={accountEmail}
        variant="compact"
        needsReconnect={needsReconnect}
        onReconnect={onReconnect}
      />
    );
  }

  if (needsReconnect) {
    return (
      <SourceReconnectBanner
        provider={provider}
        needsReconnect={true}
        onReconnect={onReconnect}
      />
    );
  }

  const count = managerBadge
    ? summarizeAccountScope(provider, [{ id: managerBadge, label: managerBadge }], 1)
    : summarizeAccountScope(provider, [], 1);

  return (
    <section className="rounded-xl border border-line bg-canvas shadow-xs p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-sm font-semibold tracking-tight text-ink">
          {PROVIDER_DISPLAY_NAME[provider] || connectionName || provider}
        </h3>
        {managerBadge ? (
          <CopyableBadge
            text={managerBadge}
            copyValue={managerBadge.replace(/^\[|\]$/g, "").replace(/^(MCC|BM|BC|Shop|Store|CID|Adv|Seller|SP|act_):\s*/, "")}
            title={`Click to copy ${managerBadge}`}
            className="text-[10px] text-ink-mute border-line/70 bg-canvas/80"
          />
        ) : null}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-mute">
        {count.countLabel} enabled for warehouse sync.
      </p>
    </section>
  );
}
