import { Copy, Database, KeyRound, MapPin, MapPinOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

type ApiKeyRow = {
  id: string;
  name: string;
  keyMasked?: string;
  useCount?: number;
  lastUsedAt?: string | null;
  ipPinned?: boolean;
};

function lastUsedLabel(iso: string | null | undefined): string {
  if (!iso) return "never used";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "unknown";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ApiKeysTab({
  apiKeys,
  newlyGeneratedKey,
  isGenerating,
  canManage,
  handleGenerateKey,
  handleDeleteKey,
  handleRotateKey,
  handlePinKey,
  allowApiKeys = true,
}: {
  apiKeys: ApiKeyRow[];
  newlyGeneratedKey: string | null;
  isGenerating: boolean;
  canManage: boolean;
  handleGenerateKey: () => Promise<void>;
  handleDeleteKey: (id: string) => Promise<void>;
  handleRotateKey?: (id: string) => Promise<void>;
  handlePinKey?: (id: string, enabled: boolean) => Promise<void>;
  allowApiKeys?: boolean;
}) {
  const copy = (value: string) => { void navigator.clipboard.writeText(value); toast.success("Copied"); };
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h3 className="flex items-center text-lg font-semibold text-ink">
          <KeyRound className="mr-2 h-5 w-5 text-ink-mute" strokeWidth={1.5} />
          API keys
        </h3>
        <p className="mt-1 text-sm text-ink-mute">
          Workspace-scoped bearer credentials used by Looker Studio. New secrets are shown only once. A key with high use from many places may be shared — rotate it and hand out one key per integration.
        </p>
      </div>
      {!allowApiKeys ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-ink-mute">
          API keys are included on Studio and Agency. The Start plan is Sheets-only (Google sign-in, no key).
        </p>
      ) : null}
      {newlyGeneratedKey ? (
        <div className="rounded-lg border border-line bg-canvas p-4">
          <p className="font-semibold text-ink">Copy this key now</p>
          <div className="mt-3 flex gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-panel p-3 text-xs text-ink">{newlyGeneratedKey}</code>
            <button onClick={() => copy(newlyGeneratedKey)} aria-label="Copy API key" className="rounded-md border border-line bg-panel px-3 text-ink">
              <Copy className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      ) : null}
      <div className="rounded-lg border border-line bg-canvas p-5">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-sm font-medium text-ink">Active keys</h4>
          {canManage && allowApiKeys ? (
            <button onClick={handleGenerateKey} disabled={isGenerating} className="flex items-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              <Plus className="mr-2 h-4 w-4" strokeWidth={1.5} />Generate
            </button>
          ) : null}
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {apiKeys.map((key) => (
            <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Database className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {key.name}
                    {key.ipPinned ? (
                      <span className="ml-2 rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] font-semibold text-ink-mute">IP-pinned</span>
                    ) : null}
                  </p>
                  <code className="text-xs text-slate-500">{key.keyMasked}</code>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {key.useCount ?? 0} uses · last used {lastUsedLabel(key.lastUsedAt)}
                  </p>
                </div>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-2">
                  {handleRotateKey ? (
                    <button
                      onClick={() => void handleRotateKey(key.id)}
                      aria-label={`Rotate ${key.name}`}
                      title="Generate a replacement secret and revoke this one"
                      className="flex items-center rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs font-semibold text-ink"
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />Rotate
                    </button>
                  ) : null}
                  {handlePinKey ? (
                    <button
                      onClick={() => void handlePinKey(key.id, !key.ipPinned)}
                      aria-label={`${key.ipPinned ? "Unpin" : "Pin"} ${key.name} to this network`}
                      title={key.ipPinned ? "Remove the office-IP restriction" : "Restrict this key to your current network (static office IPs only)"}
                      className="flex items-center rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs font-semibold text-ink"
                    >
                      {key.ipPinned ? <MapPinOff className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> : <MapPin className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />}
                      {key.ipPinned ? "Unpin" : "Pin"}
                    </button>
                  ) : null}
                  <button
                    onClick={() => void handleDeleteKey(key.id)}
                    aria-label={`Delete ${key.name}`}
                    className="rounded-md border border-line bg-panel p-1.5 text-ink"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
