import React from 'react';
import { Briefcase, Search, Plus, Trash2, Activity, User, ExternalLink } from "lucide-react";

interface ClientsTabProps {
    clients: any[];
    unassignedConns: any[];
    unassignedSearch: string;
    setUnassignedSearch: (val: string) => void;
    isAddingClient: boolean;
    setIsAddingClient: (val: boolean) => void;
    newClientName: string;
    setNewClientName: (val: string) => void;
    editingClientId: string | null;
    setEditingClientId: (id: string | null) => void;
    editClientNameValue: string;
    setEditClientNameValue: (val: string) => void;
    handleAddClient: () => Promise<void>;
    handleUpdateClient: (id: string) => Promise<void>;
    handleDeleteClient: (id: string) => Promise<void>;
    handleAssignClient: (connId: string, clientId: string) => Promise<void>;
    handleUnassignClient: (connId: string) => Promise<void>;
}

export function ClientsTab({
    clients,
    unassignedConns,
    unassignedSearch,
    setUnassignedSearch,
    isAddingClient,
    setIsAddingClient,
    newClientName,
    setNewClientName,
    editingClientId,
    setEditingClientId,
    editClientNameValue,
    setEditClientNameValue,
    handleAddClient,
    handleUpdateClient,
    handleDeleteClient,
    handleAssignClient,
    handleUnassignClient
}: ClientsTabProps) {
    const filteredUnassigned = unassignedConns.filter(c =>
        (c.provider || '').toLowerCase().includes(unassignedSearch.toLowerCase()) ||
        (c.name || '').toLowerCase().includes(unassignedSearch.toLowerCase())
    );

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Header */}
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                    <Briefcase className="w-5 h-5 mr-2 text-cyan-600 dark:text-cyan-400" />
                    Client Management
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Organize your data sources by assigning them to specific clients.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left: Clients List */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800/40 backdrop-blur-sm shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 dark:border-white/10 flex justify-between items-center bg-slate-50/80 dark:bg-slate-900/40">
                            <h4 className="text-sm font-medium text-gray-700 dark:text-slate-300">Your Clients</h4>
                            <button
                                onClick={() => setIsAddingClient(true)}
                                className="text-xs font-semibold text-cyan-600 hover:text-cyan-700 flex items-center"
                            >
                                <Plus className="w-3.5 h-3.5 mr-1" /> Add Client
                            </button>
                        </div>

                        {isAddingClient && (
                            <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-100 dark:border-white/5">
                                <div className="flex gap-2">
                                    <input
                                        autoFocus
                                        placeholder="Enter client name..."
                                        value={newClientName}
                                        onChange={e => setNewClientName(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddClient()}
                                        className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-cyan-500/40 text-gray-900 dark:text-white flex-1 placeholder:text-slate-400"
                                    />
                                    <button onClick={handleAddClient} className="px-3 py-1.5 bg-cyan-600 text-white text-xs font-bold rounded-lg">Add</button>
                                    <button onClick={() => setIsAddingClient(false)} className="px-3 py-1.5 text-gray-500 text-xs font-medium">Cancel</button>
                                </div>
                            </div>
                        )}

                        <div className="divide-y divide-white/5 px-4 pb-4">
                            {clients.length === 0 ? (
                                <div className="p-8 text-center">
                                    <Briefcase className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                                    <p className="text-sm text-gray-500">No clients created yet.</p>
                                </div>
                            ) : clients.map(client => (
                                <div key={client.id} className="p-5 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                    <div className="flex justify-between items-start mb-4">
                                        {editingClientId === client.id ? (
                                            <div className="flex gap-2 flex-1">
                                                <input
                                                    value={editClientNameValue}
                                                    onChange={e => setEditClientNameValue(e.target.value)}
                                                    className="px-2 py-1 text-sm bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-md outline-none text-gray-900 dark:text-white placeholder:text-slate-400 focus:ring-1 focus:ring-cyan-500/40"
                                                />
                                                <button onClick={() => handleUpdateClient(client.id)} className="text-xs text-cyan-600 font-bold">Save</button>
                                                <button onClick={() => setEditingClientId(null)} className="text-xs text-gray-500">Cancel</button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center group">
                                                <h5 className="font-semibold text-gray-900 dark:text-white">{client.name}</h5>
                                                <button
                                                    onClick={() => { setEditingClientId(client.id); setEditClientNameValue(client.name); }}
                                                    className="ml-2 p-1 text-gray-400 hover:text-cyan-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <Plus className="w-3.5 h-3.5 rotate-45" />
                                                </button>
                                            </div>
                                        )}
                                        <button onClick={() => handleDeleteClient(client.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        {client.connections?.map((conn: any) => (
                                            <div key={conn.id} className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-white/5">
                                                <div className="flex items-center">
                                                    <div className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700/60 flex items-center justify-center mr-2 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                                        {conn.provider.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="font-medium text-gray-700 dark:text-gray-300">{conn.name || conn.provider}</span>
                                                </div>
                                                <button
                                                    onClick={() => handleUnassignClient(conn.id)}
                                                    className="text-gray-400 hover:text-red-500 font-medium"
                                                >
                                                    Unassign
                                                </button>
                                            </div>
                                        ))}
                                        {(!client.connections || client.connections.length === 0) && (
                                            <p className="text-[11px] text-gray-400 italic py-1">No connections assigned.</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right: Unassigned Inventory */}
                <div className="space-y-4">
                    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/10 bg-slate-50/80 dark:bg-slate-800/30 backdrop-blur-sm p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Unassigned Sources</h4>
                            <span className="bg-slate-200 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                {unassignedConns.length}
                            </span>
                        </div>

                        <div className="relative mb-4">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                                placeholder="Search connections..."
                                value={unassignedSearch}
                                onChange={e => setUnassignedSearch(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-cyan-500/40 text-gray-900 dark:text-white placeholder:text-slate-400"
                            />
                        </div>

                        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                            {filteredUnassigned.length === 0 ? (
                                <p className="text-center text-xs text-gray-400 py-8">All clear!</p>
                            ) : filteredUnassigned.map(conn => (
                                <div key={conn.id} className="group p-3 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-white/5 rounded-xl hover:border-cyan-400 dark:hover:border-cyan-400/30 hover:shadow-sm transition-all" style={{ transition: 'all 250ms cubic-bezier(0.25,1,0.5,1)' }}>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center">
                                            <Activity className="w-3 h-3 mr-2 text-green-500" />
                                            <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 truncate max-w-[100px]">
                                                {conn.name || conn.provider}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 flex-wrap">
                                        {clients.map(client => (
                                            <button
                                                key={client.id}
                                                onClick={() => handleAssignClient(conn.id, client.id)}
                                                className="text-[10px] px-2 py-0.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 text-slate-500 dark:text-slate-400 hover:text-cyan-700 dark:hover:text-cyan-300 border border-slate-200 dark:border-white/5 hover:border-cyan-300 dark:hover:border-cyan-500/20 rounded-md transition-colors"
                                            >
                                                + {client.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
