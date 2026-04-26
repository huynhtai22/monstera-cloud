import React, { useState } from 'react';
import { Building2, Save, Sparkles, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

export function WorkspaceTab({ 
    activeWorkspace, 
    activeWorkspaceId, 
    telegramChatDraft, 
    setTelegramChatDraft,
    telegramSaving,
    setTelegramSaving,
    telegramTesting,
    setTelegramTesting,
    demoMaster,
    setDemoMaster,
    demoMeta,
    setDemoMeta,
    demoShopee,
    setDemoShopee,
    demoGoogleAds,
    setDemoGoogleAds,
    demoSaving,
    setDemoSaving
}: any) {
    const { mutate: globalMutate } = useSWRConfig();

    const handleSaveTelegram = async () => {
        setTelegramSaving(true);
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ telegramChatId: telegramChatDraft || null }),
            });
            if (res.ok) {
                toast.success("Telegram chat ID saved");
                globalMutate("/api/workspaces");
            } else {
                toast.error("Failed to save");
            }
        } finally {
            setTelegramSaving(false);
        }
    };

    const handleTestTelegram = async () => {
        setTelegramTesting(true);
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/test-telegram`, { method: "POST" });
            if (res.ok) {
                toast.success("Test message sent! Check your Telegram.");
            } else {
                const err = await res.json();
                toast.error(err.error || "Failed to send test message");
            }
        } finally {
            setTelegramTesting(false);
        }
    };

    const handleSaveDemoMode = async () => {
        setDemoSaving(true);
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    demoMockMode: demoMaster,
                    demoMockMeta: demoMeta,
                    demoMockShopee: demoShopee,
                    demoMockGoogleAds: demoGoogleAds
                }),
            });
            if (res.ok) {
                toast.success("Demo preferences saved");
                globalMutate("/api/workspaces");
            } else {
                toast.error("Failed to save demo preferences");
            }
        } finally {
            setDemoSaving(false);
        }
    };

    return (
        <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                    <Building2 className="w-5 h-5 mr-2 text-cyan-600 dark:text-cyan-400" />
                    Workspace Settings
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Manage your workspace preferences and notifications.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4 flex items-center">
                    <MessageCircle className="w-4 h-4 mr-2 text-cyan-600" />
                    Telegram Notifications
                </h4>
                <div className="space-y-4 max-w-xl">
                    <div>
                        <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1.5">Chat ID</label>
                        <input
                            type="text"
                            placeholder="-100123456789"
                            value={telegramChatDraft}
                            onChange={(e) => setTelegramChatDraft(e.target.value)}
                            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all dark:text-white"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                            Add our bot to your group and enter the Chat ID. Starts with a minus sign for groups.
                        </p>
                    </div>
                    <div className="flex space-x-3">
                        <button
                            onClick={handleSaveTelegram}
                            disabled={telegramSaving}
                            className="flex items-center px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
                        >
                            {telegramSaving ? "Saving..." : <><Save className="w-4 h-4 mr-2" />Save</>}
                        </button>
                        <button
                            onClick={handleTestTelegram}
                            disabled={telegramTesting || !activeWorkspace?.telegramChatId}
                            className="flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-all disabled:opacity-50"
                        >
                            {telegramTesting ? "Sending..." : "Test Message"}
                        </button>
                    </div>
                </div>
            </div>

            <div id="product-demo" className="bg-white dark:bg-slate-900 border border-violet-200/60 dark:border-violet-900/30 rounded-2xl p-6 shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-32 bg-violet-400/5 dark:bg-violet-400/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />

                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4 flex items-center">
                    <Sparkles className="w-4 h-4 mr-2 text-violet-600 dark:text-violet-400" />
                    Product Demo Mode
                </h4>
                <div className="space-y-6 max-w-xl relative">
                    <div className="flex items-start">
                        <div className="flex items-center h-5">
                            <input
                                id="demo-master"
                                type="checkbox"
                                checked={demoMaster}
                                onChange={(e) => setDemoMaster(e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600"
                            />
                        </div>
                        <div className="ml-3 text-sm">
                            <label htmlFor="demo-master" className="font-medium text-gray-900 dark:text-white">Enable Sales Demo Experience</label>
                            <p className="text-gray-500 dark:text-gray-400">If enabled, the UI will showcase fake robust data to prospect customers.</p>
                        </div>
                    </div>

                    {demoMaster && (
                        <div className="pl-7 space-y-4 animate-in fade-in slide-in-from-top-2">
                            <label className="flex items-center space-x-3 text-sm text-gray-700 dark:text-gray-300">
                                <input type="checkbox" checked={demoMeta} onChange={e => setDemoMeta(e.target.checked)} className="rounded text-violet-600 focus:ring-violet-600" />
                                <span>Mock Meta Ads Performance Data</span>
                            </label>
                            <label className="flex items-center space-x-3 text-sm text-gray-700 dark:text-gray-300">
                                <input type="checkbox" checked={demoGoogleAds} onChange={e => setDemoGoogleAds(e.target.checked)} className="rounded text-violet-600 focus:ring-violet-600" />
                                <span>Mock Google Ads Search Data</span>
                            </label>
                            <label className="flex items-center space-x-3 text-sm text-gray-700 dark:text-gray-300">
                                <input type="checkbox" checked={demoShopee} onChange={e => setDemoShopee(e.target.checked)} className="rounded text-violet-600 focus:ring-violet-600" />
                                <span>Mock Shopee E-commerce Orders</span>
                            </label>
                        </div>
                    )}

                    <button
                        onClick={handleSaveDemoMode}
                        disabled={demoSaving}
                        className="flex items-center px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
                    >
                        {demoSaving ? "Saving..." : "Save Preferences"}
                    </button>
                </div>
            </div>
        </div>
    );
}
