"use client";

import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { DemoModeBanner } from './DemoModeBanner';
import { Menu, Moon, Sun } from 'lucide-react';
import { Toaster } from 'sonner';

export function AppLayout({ children }: { children: React.ReactNode }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(false);

    // Sync dark mode: toggle .dark on <html> while .disable-transitions avoids theme flash
    useEffect(() => {
        const root = document.documentElement;
        root.classList.add("disable-transitions");
        requestAnimationFrame(() => {
            if (isDarkMode) {
                root.classList.add("dark");
            } else {
                root.classList.remove("dark");
            }
            requestAnimationFrame(() => {
                root.classList.remove("disable-transitions");
            });
        });
    }, [isDarkMode]);

    const toggleDarkMode = () => setIsDarkMode(!isDarkMode);

    return (
        <div className="flex min-h-screen font-sans">
            {/* Mobile Header (only visible on small screens) */}
            <div className="lg:hidden fixed top-0 w-full h-16 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 z-30 flex items-center justify-between px-4">
                <div className="flex items-center">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 dark:text-gray-300">
                        <Menu className="w-6 h-6" />
                    </button>
                    <div className="font-bold text-lg text-gray-900 dark:text-white ml-2">Monstera</div>
                </div>
                <button onClick={toggleDarkMode} className="p-2 text-gray-500 dark:text-gray-400">
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
            </div>

            <Sidebar
                isOpen={isSidebarOpen}
                setIsOpen={setIsSidebarOpen}
                isDarkMode={isDarkMode}
                toggleDarkMode={toggleDarkMode}
            />

            <div className="flex-1 flex flex-col min-w-0 bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-200">
                <div className="lg:hidden h-16 shrink-0"></div>
                <main className="flex-1 overflow-x-hidden">
                    <DemoModeBanner />
                    {children}
                </main>
            </div>

            {/* Mobile Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-40 lg:hidden transition-opacity"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            <Toaster richColors closeButton position="top-center" />
        </div>
    );
}
