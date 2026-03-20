"use client";

import React, { useState, useEffect } from 'react';
import { Settings2, Building2, Users, CreditCard, KeyRound, Save, Plus, AlertCircle, CheckCircle2, Copy } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<'workspace' | 'team' | 'billing' | 'api'>('workspace');
    const { activeWorkspaceId } = useWorkspaceStore();
    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        if (activeTab === 'api' && activeWorkspaceId) {
            fetchApiKeys();
        }
    }, [activeTab, activeWorkspaceId]);

    const fetchApiKeys = async () => {
        try {
            const res = await fetch(`/api/settings/api-keys?workspaceId=${activeWorkspaceId}`);
            if (res.ok) {
                const data = await res.json();
                setApiKeys(data);
            }
        } catch (error) {
            console.error("Failed to fetch API keys");
        }
    };

    const handleGenerateKey = async () => {
        if (!activeWorkspaceId) return;
        setIsGenerating(true);
        try {
            const res = await fetch('/api/settings/api-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: activeWorkspaceId, name: "Google Sheets Add-on Key" })
            });
            if (res.ok) {
                const newKey = await res.json();
                setNewlyGeneratedKey(newKey.key); // Show the raw key just once
                fetchApiKeys(); // Refresh list
            } else {
                const errData = await res.json().catch(() => ({}));
                alert(`Failed to generate key: ${errData.error || res.statusText}`);
            }
        } catch (error: any) {
            console.error("Failed to generate key", error);
            alert(`Network or server error: ${error.message}`);
        }
        setIsGenerating(false);
    };

    const handleRevokeKey = async (id: string) => {
        if (!activeWorkspaceId) return;
        try {
            const res = await fetch(`/api/settings/api-keys?id=${id}&workspaceId=${activeWorkspaceId}`, {
                method: 'DELETE'
            });
            if (res.ok) fetchApiKeys();
        } catch (error) {
            console.error("Failed to revoke key");
        }
    };

    const copyToClipboard = () => {
        if (newlyGeneratedKey) {
            navigator.clipboard.writeText(newlyGeneratedKey);
            alert("API Key copied to clipboard! Keep it safe.");
            setNewlyGeneratedKey(null); // Hide after copy
        }
    };

    return (
        <div className="relative max-w-5xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Liquid Glass Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[10%] left-[20%] w-[30%] h-[30%] rounded-full bg-slate-200/40 blur-[100px]" />
            </div>

            {/* Header Section */}
            <div className="mb-8 relative z-10">
                <div className="flex items-center space-x-3 mb-2">
                    <div className="w-10 h-10 bg-white/80 backdrop-blur-md border border-gray-200/60 rounded-xl flex items-center justify-center shadow-sm text-gray-700">
                        <Settings2 className="w-5 h-5" />
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Settings</h1>
                </div>
                <p className="text-gray-500 text-sm">
                    Manage your workspace, team members, billing, and developer configuration.
                </p>
            </div>

            <div className="flex flex-col md:flex-row gap-8 relative z-10">

                {/* Settings Sidebar Nav */}
                <div className="w-full md:w-64 shrink-0">
                    <nav className="space-y-1">
                        <button
                            onClick={() => setActiveTab('workspace')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'workspace' ? 'bg-white shadow-sm border border-gray-200/60 text-emerald-700' : 'text-gray-600 hover:bg-white/50 hover:text-gray-900 transparent border border-transparent'}`}
                        >
                            <Building2 className={`w-4 h-4 mr-3 ${activeTab === 'workspace' ? 'text-emerald-600' : 'text-gray-400'}`} />
                            Workspace
                        </button>
                        <button
                            onClick={() => setActiveTab('team')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'team' ? 'bg-white shadow-sm border border-gray-200/60 text-emerald-700' : 'text-gray-600 hover:bg-white/50 hover:text-gray-900 transparent border border-transparent'}`}
                        >
                            <Users className={`w-4 h-4 mr-3 ${activeTab === 'team' ? 'text-emerald-600' : 'text-gray-400'}`} />
                            Team <span className="ml-auto bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-[10px] font-bold">4</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('billing')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'billing' ? 'bg-white shadow-sm border border-gray-200/60 text-emerald-700' : 'text-gray-600 hover:bg-white/50 hover:text-gray-900 transparent border border-transparent'}`}
                        >
                            <CreditCard className={`w-4 h-4 mr-3 ${activeTab === 'billing' ? 'text-emerald-600' : 'text-gray-400'}`} />
                            Billing
                        </button>
                        <button
                            onClick={() => setActiveTab('api')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'api' ? 'bg-white shadow-sm border border-gray-200/60 text-emerald-700' : 'text-gray-600 hover:bg-white/50 hover:text-gray-900 transparent border border-transparent'}`}
                        >
                            <KeyRound className={`w-4 h-4 mr-3 ${activeTab === 'api' ? 'text-emerald-600' : 'text-gray-400'}`} />
                            API Keys
                        </button>
                    </nav>
                </div>

                {/* Main Settings Content area */}
                <div className="flex-1 bg-white/60 backdrop-blur-xl border border-white/80 rounded-3xl shadow-sm p-6 sm:p-8 animate-in fade-in duration-300">

                    {activeTab === 'workspace' && (
                        <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">Workspace Profile</h3>
                                <p className="text-sm text-gray-500 mb-6">Update your company name and workspace URL.</p>

                                <div className="space-y-5 max-w-lg">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Workspace Name</label>
                                        <input
                                            type="text"
                                            defaultValue="Acme Corp"
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-xl focus:ring-emerald-500 focus:border-emerald-500 block p-2.5 shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Workspace URL</label>
                                        <div className="flex bg-white rounded-xl shadow-sm border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
                                            <span className="inline-flex items-center px-3 text-sm text-gray-500 bg-gray-50 border-r border-gray-200">
                                                monstera.cloud/
                                            </span>
                                            <input
                                                type="text"
                                                defaultValue="acme"
                                                className="flex-1 min-w-0 block w-full px-3 py-2.5 sm:text-sm text-gray-900 focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-gray-200/60" />

                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">Data Retention</h3>
                                <p className="text-sm text-gray-500 mb-6">Configure how long Monstera stores temporary sync logs.</p>

                                <div className="max-w-lg">
                                    <select className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-xl focus:ring-emerald-500 focus:border-emerald-500 block p-2.5 shadow-sm">
                                        <option>7 Days (Default)</option>
                                        <option>30 Days</option>
                                        <option>90 Days</option>
                                    </select>
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end">
                                <button className="flex items-center px-6 py-2.5 bg-gray-900 hover:bg-black text-white text-sm font-bold rounded-xl shadow-sm transition-colors">
                                    <Save className="w-4 h-4 mr-2" />
                                    Save Changes
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'team' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">Team Members</h3>
                                    <p className="text-sm text-gray-500">Manage who has access to this workspace.</p>
                                </div>
                                <button className="flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Invite Member
                                </button>
                            </div>

                            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-sm overflow-hidden">
                                <div className="divide-y divide-gray-100">
                                    {[
                                        { name: 'Jane Taylor', role: 'Owner', email: 'jane@acme.co', status: 'Active' },
                                        { name: 'Michael Chen', role: 'Admin', email: 'michael@acme.co', status: 'Active' },
                                        { name: 'Sarah Wilson', role: 'Viewer', email: 'sarah@acme.co', status: 'Invited' },
                                    ].map((user, i) => (
                                        <div key={i} className="flex items-center justify-between p-4 hover:bg-gray-50/50 transition-colors">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-sm border border-indigo-200">
                                                    {user.name.split(' ').map(n => n[0]).join('')}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-bold text-gray-900">{user.name}</div>
                                                    <div className="text-xs text-gray-500">{user.email}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-4">
                                                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${user.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                                    {user.status}
                                                </span>
                                                <select className="text-sm font-medium text-gray-700 bg-transparent border-none cursor-pointer focus:ring-0">
                                                    <option>{user.role}</option>
                                                    <option>Admin</option>
                                                    <option>Viewer</option>
                                                </select>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'billing' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">Current Plan</h3>
                                <p className="text-sm text-gray-500">You are currently on the Pro Tier.</p>
                            </div>

                            <div className="bg-gradient-to-br from-indigo-900 to-indigo-800 rounded-3xl p-8 text-white relative overflow-hidden shadow-xl shadow-indigo-900/10">
                                {/* Decorative elements */}
                                <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                                <div className="absolute bottom-0 left-0 w-32 h-32 bg-emerald-400 opacity-20 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2"></div>

                                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                    <div>
                                        <div className="inline-flex items-center px-3 py-1 bg-white/10 rounded-full text-xs font-semibold tracking-wider uppercase mb-4 border border-white/20">
                                            Pro Plan
                                        </div>
                                        <div className="text-4xl font-extrabold mb-2">$499 <span className="text-lg font-medium text-indigo-200">/mo</span></div>
                                        <p className="text-indigo-200 text-sm max-w-sm">
                                            Includes up to 10M rows synced per month, 15 active pipelines, and Priority Support.
                                        </p>
                                    </div>
                                    <div className="bg-white/10 backdrop-blur-md border border-white/20 p-5 rounded-2xl w-full md:w-64">
                                        <div className="flex justify-between items-end mb-2">
                                            <span className="text-sm font-medium text-indigo-100">Rows Used</span>
                                            <span className="text-sm font-bold">4.8M / 10M</span>
                                        </div>
                                        <div className="w-full bg-black/20 rounded-full h-2">
                                            <div className="bg-emerald-400 h-2 rounded-full" style={{ width: '48%' }}></div>
                                        </div>
                                        <p className="text-xs text-indigo-200 mt-3 text-center">Resets in 12 days</p>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 flex justify-between items-center">
                                <div className="flex items-center text-sm text-gray-600 font-medium">
                                    <CreditCard className="w-5 h-5 mr-2 text-gray-400" />
                                    Visa ending in 4242
                                </div>
                                <button className="text-sm font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                                    Update Payment Method
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'api' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">Developer API Keys</h3>
                                    <p className="text-sm text-gray-500">Create programmatic access tokens for the Monstera API (e.g., Google Sheets Add-on).</p>
                                </div>
                                <button 
                                    onClick={handleGenerateKey}
                                    disabled={isGenerating}
                                    className="flex items-center px-4 py-2 bg-gray-900 hover:bg-black text-white text-sm font-bold rounded-xl shadow-sm transition-colors disabled:opacity-50">
                                    <Plus className="w-4 h-4 mr-2" />
                                    {isGenerating ? "Generating..." : "Generate Key"}
                                </button>
                            </div>

                            <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 mb-6 flex items-start space-x-3">
                                <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="font-semibold text-blue-900 text-sm mb-1">Keep your keys secure</h4>
                                    <p className="text-sm text-blue-700">API keys grant full access to your workspace data. Do not commit them to public repositories or client-side code.</p>
                                </div>
                            </div>

                            {newlyGeneratedKey && (
                                <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-5 mb-6">
                                    <h4 className="font-semibold text-emerald-900 text-sm mb-2 flex items-center">
                                        <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-600" /> Key Generated Successfully
                                    </h4>
                                    <p className="text-sm text-emerald-700 mb-3">Please copy this value now. You won't be able to see it again.</p>
                                    <div className="flex items-center space-x-2">
                                        <code className="flex-1 bg-white border border-emerald-100 px-3 py-2 rounded-lg text-sm text-emerald-900 font-mono select-all">
                                            {newlyGeneratedKey}
                                        </code>
                                        <button onClick={copyToClipboard} className="p-2 border border-emerald-200 bg-white rounded-lg text-emerald-700 hover:bg-emerald-100 transition-colors">
                                            <Copy className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {apiKeys.length === 0 ? (
                                <div className="text-center py-10 border border-dashed border-gray-200 rounded-2xl">
                                    <KeyRound className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500 text-sm">No API Keys generated yet.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {apiKeys.map((keyObj) => (
                                        <div key={keyObj.id} className="bg-white border border-gray-200/60 rounded-2xl shadow-sm overflow-hidden p-4 flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-bold text-gray-900 mb-1">{keyObj.name}</div>
                                                <div className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                                    {keyObj.key.slice(0, 7)}...{keyObj.key.slice(-4)}
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-3">
                                                <div className="text-[11px] font-medium text-gray-400">
                                                    Created {new Date(keyObj.createdAt).toLocaleDateString()}
                                                </div>
                                                <button 
                                                    onClick={() => handleRevokeKey(keyObj.id)}
                                                    className="text-sm font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors">
                                                    Revoke
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
