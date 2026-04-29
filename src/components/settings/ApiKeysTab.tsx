import React from 'react';
import { KeyRound, Plus, Trash2, Copy, Eye, EyeOff, AlertCircle, ShieldAlert, Sparkles, Database } from "lucide-react";
import { toast } from "sonner";

interface ApiKeysTabProps {
    apiKeys: any[];
    newlyGeneratedKey: string | null;
    isGenerating: boolean;
    revealKeyId: string | null;
    setRevealKeyId: (id: string | null) => void;
    revealPassword: string;
    setRevealPassword: (val: string) => void;
    revealBusy: boolean;
    revealError: string | null;
    revealedKey: string | null;
    hasPassword: boolean;
    handleGenerateKey: () => Promise<void>;
    handleDeleteKey: (id: string) => Promise<void>;
    handleRevealKey: (id: string) => Promise<void>;
}

export function ApiKeysTab({
    apiKeys,
    newlyGeneratedKey,
    isGenerating,
    revealKeyId,
    setRevealKeyId,
    revealPassword,
    setRevealPassword,
    revealBusy,
    revealError,
    revealedKey,
    hasPassword,
    handleGenerateKey,
    handleDeleteKey,
    handleRevealKey
}: ApiKeysTabProps) {
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("Copied to clipboard");
    };

    return (
        <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                    <KeyRound className="w-5 h-5 mr-2 text-cyan-600 dark:text-cyan-400" />
                    API & Developer Keys
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Use these keys to access your data programmatically via our API.
                </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-800/40 backdrop-blur-sm p-6">
                <div className="flex items-center justify-between mb-6">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">Active API Keys</h4>
                    <button
                        onClick={handleGenerateKey}
                        disabled={isGenerating}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-xl transition-all shadow-sm flex items-center"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {isGenerating ? "Generating..." : "Generate New Key"}
                    </button>
                </div>

                {newlyGeneratedKey && (
                    <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl animate-in zoom-in-95 duration-300">
                        <div className="flex items-start mb-3">
                            <AlertCircle className="w-5 h-5 text-emerald-600 mr-3 mt-0.5" />
                            <div>
                                <h5 className="text-sm font-bold text-emerald-900 dark:text-emerald-400">Save your new key!</h5>
                                <p className="text-xs text-emerald-700/80 dark:text-emerald-500/80">For security, we only show this key once. If you lose it, you'll need to generate a new one.</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <code className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-mono text-emerald-700 dark:text-emerald-400 break-all select-all">
                                {newlyGeneratedKey}
                            </code>
                            <button
                                onClick={() => copyToClipboard(newlyGeneratedKey)}
                                className="px-3 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"
                            >
                                <Copy className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                <div className="space-y-3">
                    {apiKeys.length === 0 ? (
                        <div className="text-center py-8 rounded-2xl border border-dashed border-white/10 bg-slate-900/30">
                            <KeyRound className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">No API keys found.</p>
                        </div>
                    ) : apiKeys.map(key => (
                        <div key={key.id} className="p-4 rounded-xl border border-white/5 bg-slate-900/40 flex items-center justify-between" style={{ transition: 'all 250ms cubic-bezier(0.25,1,0.5,1)' }}>
                            <div className="flex items-center">
                                <div className="w-8 h-8 rounded-lg bg-slate-700/60 flex items-center justify-center mr-3">
                                    <Database className="w-4 h-4 text-gray-500" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">{key.name || 'Default Key'}</p>
                                        <code className="text-[10px] px-1.5 py-0.5 bg-gray-200 dark:bg-slate-800 text-gray-600 dark:text-gray-400 rounded">
                                            {key.keyPrefix}...
                                        </code>
                                    </div>
                                    <p className="text-[10px] text-gray-500">Created on {new Date(key.createdAt).toLocaleDateString()}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {revealKeyId === key.id ? (
                                    <div className="flex flex-col items-end gap-2 animate-in fade-in slide-in-from-right-2">
                                        {revealedKey ? (
                                            <div className="flex gap-2">
                                                <code className="px-2 py-1 bg-white dark:bg-slate-900 border border-gray-200 rounded text-[10px] font-mono">{revealedKey}</code>
                                                <button onClick={() => setRevealKeyId(null)} className="text-[10px] text-gray-500 font-bold">Hide</button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                {hasPassword && (
                                                    <input
                                                        type="password"
                                                        placeholder="Confirm password"
                                                        className="px-2 py-1 text-[10px] bg-slate-900/60 border border-white/10 rounded outline-none w-32 text-white placeholder:text-slate-500 focus:ring-1 focus:ring-cyan-400/50"
                                                        value={revealPassword}
                                                        onChange={e => setRevealPassword(e.target.value)}
                                                    />
                                                )}
                                                <button
                                                    onClick={() => handleRevealKey(key.id)}
                                                    disabled={revealBusy}
                                                    className="text-[10px] bg-cyan-600 text-white px-2 py-1 rounded font-bold"
                                                >
                                                    {revealBusy ? "..." : "Reveal"}
                                                </button>
                                                <button onClick={() => setRevealKeyId(null)} className="text-[10px] text-gray-500">Cancel</button>
                                            </div>
                                        )}
                                        {revealError && <p className="text-[9px] text-red-500">{revealError}</p>}
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setRevealKeyId(key.id)}
                                        className="p-2 text-gray-400 hover:text-cyan-600 transition-colors"
                                        title="Reveal full key"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </button>
                                )}
                                <button
                                    onClick={() => handleDeleteKey(key.id)}
                                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* API Documentation Preview */}
            <div className="rounded-2xl p-6 border border-white/10 bg-slate-900/60 shadow-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-32 bg-cyan-500/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                <h4 className="text-sm font-medium text-white mb-4 flex items-center">
                    <Sparkles className="w-4 h-4 mr-2 text-cyan-400" />
                    Quick Integration
                </h4>
                <div className="relative">
                    <pre className="text-[11px] font-mono text-cyan-300/80 bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-x-auto">
                        {`# Fetch your meta ads report via API
curl -X POST https://monsteracloud.com/api/v1/reports \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "source": "meta_ads",
    "metrics": ["impressions", "clicks", "spend"]
  }'`}
                    </pre>
                </div>
            </div>
        </div>
    );
}
