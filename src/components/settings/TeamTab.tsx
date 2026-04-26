import React from 'react';
import { Users } from "lucide-react";
import { MOCK_TEAM } from "@/lib/mock-console-data";

export function TeamTab() {
    return (
        <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                    <Users className="w-5 h-5 mr-2 text-cyan-600 dark:text-cyan-400" />
                    Team Management
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Manage who has access to this workspace.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">Active Members</h4>
                    <button className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-xl transition-all shadow-sm">
                        Invite Member
                    </button>
                </div>

                <div className="space-y-4">
                    {MOCK_TEAM.map(member => (
                        <div key={member.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/20">
                            <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 rounded-full bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center text-cyan-700 dark:text-cyan-400 font-medium">
                                    {member.name.charAt(0)}
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">{member.name}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{member.email}</p>
                                </div>
                            </div>
                            <div className="flex items-center space-x-4">
                                <span className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300">
                                    {member.role}
                                </span>
                                {member.role !== 'Admin' && (
                                    <button className="text-sm text-red-600 hover:text-red-700 font-medium">Remove</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
