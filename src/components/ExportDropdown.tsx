"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileText, FileSpreadsheet, ChevronDown } from "lucide-react";

interface ExportDropdownProps {
  onCsv: () => void;
  onExcel: () => void;
  /** Extra Tailwind classes for the trigger button wrapper */
  className?: string;
}

/**
 * A small dropdown button that offers "Export as CSV" and "Export as Excel"
 * options. Closes automatically when the user clicks outside.
 */
export function ExportDropdown({ onCsv, onExcel, className = "" }: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-2.5 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors select-none"
      >
        <Download className="w-3 h-3" />
        Export
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 mt-1.5 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-50 overflow-hidden py-1">
          <button
            onClick={() => {
              onCsv();
              setOpen(false);
            }}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            Export as CSV
          </button>
          <button
            onClick={() => {
              onExcel();
              setOpen(false);
            }}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
            Export as Excel
          </button>
        </div>
      )}
    </div>
  );
}
