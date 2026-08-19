"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { 
  X, 
  Copy, 
  Check, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  RefreshCw, 
  Terminal, 
  Database, 
  FileText, 
  ShieldAlert,
  HelpCircle,
  Network,
  HardDrive
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "./PrimaryButton";
import { SecondaryButton } from "./SecondaryButton";
import { useMounted } from "@/hooks/useMounted";
import { classifyIngestionError } from "@/lib/ingestion/error-taxonomy";

const DRAWER_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const DRAWER_DURATION_MS = 300;

export type SyncLogWithPipeline = {
  id: string;
  status: string;
  rowsSynced: number;
  durationMs: number;
  errorMsg?: string | null;
  createdAt: string;
  pipeline: {
    id: string;
    name: string;
    sourceConnectionId: string;
    destinationConnectionId?: string;
    clientId?: string | null;
    workspaceId?: string;
  };
};

type SyncLogDiagnosticsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  log: SyncLogWithPipeline | null;
  workspaceId: string;
  workspaceName?: string;
  onRetry?: (pipelineId: string) => Promise<void>;
};

export function SyncLogDiagnosticsDrawer({
  isOpen,
  onClose,
  log,
  workspaceId,
  workspaceName = "Workspace",
  onRetry,
}: SyncLogDiagnosticsDrawerProps) {
  const mounted = useMounted();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(isOpen);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    setIsVisible(false);
    const t = setTimeout(() => setShouldRender(false), DRAWER_DURATION_MS);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!shouldRender || !mounted || !log) return null;

  const errorClass = log.status === "error" ? classifyIngestionError(log.errorMsg) : null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCopyDiagnostics = () => {
    const report = `### Monstera Cloud Ingestion Diagnostic Report
- **Log ID:** \`${log.id}\`
- **Pipeline:** \`${log.pipeline?.name} (${log.pipeline?.id})\`
- **Workspace:** \`${workspaceName} (${workspaceId})\`
- **Client ID:** \`${log.pipeline?.clientId || "N/A"}\`
- **Source Connection:** \`${log.pipeline?.sourceConnectionId || "N/A"}\`
- **Status:** \`${log.status.toUpperCase()}\`
- **Rows Synced:** \`${log.rowsSynced}\`
- **Duration:** \`${log.durationMs}ms (${(log.durationMs / 1000).toFixed(2)}s)\`
- **Timestamp:** \`${new Date(log.createdAt).toISOString()} (${new Date(log.createdAt).toLocaleString()})\`
${errorClass ? `- **Error Tag:** \`${errorClass.tag}\`\n- **Error Kind:** \`${errorClass.kind}\`\n` : ""}
#### Raw Error Message / Logs:
\`\`\`
${log.errorMsg || "None"}
\`\`\`
`;

    navigator.clipboard.writeText(report);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleRetry = async () => {
    if (!onRetry || !log.pipeline?.id) return;
    setRetryBusy(true);
    try {
      await onRetry(log.pipeline.id);
    } finally {
      setRetryBusy(false);
    }
  };

  // Map error types to visual indicators and icons
  const getErrorKindBadge = (kind: string) => {
    switch (kind) {
      case "auth":
        return {
          icon: <ShieldAlert className="h-4 w-4" />,
          label: "Authentication failure",
          style: "bg-red-50 text-red-800 border-red-100 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/40"
        };
      case "quota":
        return {
          icon: <Clock className="h-4 w-4" />,
          label: "Rate Limit / Quota Exceeded",
          style: "bg-amber-50 text-amber-800 border-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/40"
        };
      case "network":
        return {
          icon: <Network className="h-4 w-4" />,
          label: "Network / Connection Timeout",
          style: "bg-amber-50 text-amber-800 border-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/40"
        };
      case "destination":
        return {
          icon: <HardDrive className="h-4 w-4" />,
          label: "Destination write failed",
          style: "bg-orange-50 text-orange-800 border-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-900/40"
        };
      case "source":
        return {
          icon: <Database className="h-4 w-4" />,
          label: "Source extract failed",
          style: "bg-red-50 text-red-800 border-red-100 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/40"
        };
      case "validation":
        return {
          icon: <AlertTriangle className="h-4 w-4" />,
          label: "Validation / Schema mismatch",
          style: "bg-purple-50 text-purple-800 border-purple-100 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-900/40"
        };
      default:
        return {
          icon: <HelpCircle className="h-4 w-4" />,
          label: "Unknown ingestion error",
          style: "bg-gray-50 text-gray-800 border-gray-100 dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-800/80"
        };
    }
  };

  const idItems = [
    { label: "Run ID", value: log.id, key: "runId" },
    { label: "Pipeline ID", value: log.pipeline?.id, key: "pipelineId" },
    { label: "Workspace ID", value: workspaceId, key: "workspaceId" },
    ...(log.pipeline?.sourceConnectionId ? [{ label: "Source Conn ID", value: log.pipeline.sourceConnectionId, key: "sourceConnId" }] : []),
    ...(log.pipeline?.clientId ? [{ label: "Client ID", value: log.pipeline.clientId, key: "clientId" }] : []),
  ];

  const drawerContent = (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex justify-end",
        !isVisible && "pointer-events-none"
      )}
      role="presentation"
    >
      {/* Backdrop */}
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/45 backdrop-blur-sm dark:bg-black/60",
          "transition-opacity duration-300 ease-out",
          isVisible ? "opacity-100" : "opacity-0"
        )}
        aria-label="Close panel"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={cn(
          "relative z-10 flex h-full w-full flex-col border-l border-gray-200/90 bg-white/95 shadow-[0_0_50px_-12px_rgba(0,0,0,0.25)] backdrop-blur-md dark:border-slate-800/80 dark:bg-[#000000]/95 sm:max-w-lg lg:max-w-xl",
          "transition-transform duration-[300ms] ease-out",
          isVisible ? "translate-x-0" : "translate-x-full"
        )}
        style={{ transitionTimingFunction: DRAWER_EASE }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-white shadow-xs"
              aria-hidden
            />
            <h2 id="drawer-title" className="text-xs font-bold uppercase tracking-[0.2em] text-ink-mute">
              Run Diagnostics
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-mute hover:bg-white/[0.06] hover:text-white"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main Status Hero */}
          <div className={cn(
            "rounded-lg border p-5 relative overflow-hidden",
            log.status === "success" 
              ? "border-line bg-canvas text-ink"
              : "border-red-950/40 bg-red-950/10 text-red-100"
          )}>
            <div className="relative z-10">
              <div className="flex items-center gap-3">
                {log.status === "success" ? (
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-panel border border-line text-white">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-red-500/10 text-red-400">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-lg leading-tight text-gray-900 dark:text-white">
                    {log.pipeline?.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-slate-800/80 dark:bg-[#16181c]/40">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">Rows Ingested</span>
              <p className="mt-1 text-2xl font-extrabold text-gray-900 dark:text-white">
                {log.rowsSynced.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-slate-800/80 dark:bg-[#16181c]/40">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">Duration</span>
              <p className="mt-1 text-2xl font-extrabold text-gray-900 dark:text-white">
                {log.durationMs >= 1000 
                  ? `${(log.durationMs / 1000).toFixed(2)}s` 
                  : `${log.durationMs}ms`}
              </p>
            </div>
          </div>

          {/* Error Taxonomy Section (If failed) */}
          {errorClass && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                Classification & Error Details
              </h4>
              
              {/* Kind Badge */}
              {(() => {
                const badge = getErrorKindBadge(errorClass.kind);
                return (
                  <div className={cn("flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold", badge.style)}>
                    {badge.icon}
                    <span>{badge.label}</span>
                  </div>
                );
              })()}

              {/* Raw message block */}
              <div className="relative group">
                <div className="absolute right-3 top-3 z-10 flex gap-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(log.errorMsg || "", "rawError")}
                    className="rounded-lg bg-white/80 p-1.5 text-gray-500 shadow-sm border border-gray-200 hover:text-gray-900 hover:bg-white dark:bg-slate-900/80 dark:border-slate-850 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition"
                    title="Copy raw message"
                  >
                    {copiedKey === "rawError" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 border border-gray-150 rounded-t-xl dark:bg-[#16181c] dark:border-slate-850 text-xs font-bold text-gray-500">
                  <Terminal className="h-3.5 w-3.5" />
                  <span>Execution logs</span>
                </div>
                <pre className="whitespace-pre-wrap rounded-b-xl border-x border-b border-gray-150 bg-gray-50/50 p-4 font-mono text-xs text-red-600 dark:border-slate-850 dark:text-red-400 dark:bg-[#16181c]/20 max-h-56 overflow-y-auto">
                  {log.errorMsg || "No detailed error message was stored."}
                </pre>
              </div>
            </div>
          )}

          {/* Copy-pasteable Diagnostics IDs */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">
              Diagnostic Identifiers
            </h4>
            <div className="rounded-xl border border-gray-100 bg-gray-50/30 p-2 dark:border-slate-800/80 dark:bg-[#16181c]/10 space-y-2">
              {idItems.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 text-xs border-b border-gray-100/50 pb-2 last:border-b-0 last:pb-0 dark:border-slate-900/50">
                  <span className="font-semibold text-gray-500 dark:text-slate-400">{item.label}</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="select-all rounded bg-gray-100/85 px-1.5 py-0.5 text-gray-700 dark:bg-[#16181c] dark:text-slate-300">
                      {item.value || "—"}
                    </span>
                    {item.value && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(item.value, item.key)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-white"
                        title={`Copy ${item.label}`}
                      >
                        {copiedKey === item.key ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-gray-100 px-6 py-5 dark:border-slate-800/80 bg-gray-50/30 dark:bg-[#000000]/10 flex flex-col gap-2.5 sm:flex-row sm:justify-end">
          <SecondaryButton
            type="button"
            onClick={handleCopyDiagnostics}
            className="inline-flex items-center justify-center gap-2"
          >
            {copiedAll ? (
              <>
                <Check className="h-4 w-4 text-emerald-500 animate-scale" />
                Copied Package
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                Copy Support Package
              </>
            )}
          </SecondaryButton>

          {onRetry && log.pipeline?.id && (
            <PrimaryButton
              type="button"
              onClick={handleRetry}
              disabled={retryBusy}
              className="inline-flex items-center justify-center gap-2"
            >
              {retryBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Re-run Sync
            </PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(drawerContent, document.body);
}
