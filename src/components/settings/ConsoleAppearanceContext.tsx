"use client";
import { createContext, useContext } from "react";
export const ConsoleAppearanceContext = createContext<{ isDarkMode: boolean; toggleDarkMode: () => void; hrefFor: (href: string) => string } | null>(null);
export const useConsoleAppearance = () => useContext(ConsoleAppearanceContext);
