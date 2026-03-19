import React from "react";

export function Logo({ className = "w-8 h-8", textClassName = "text-xl font-bold" }: { className?: string, textClassName?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`relative flex items-center justify-center rounded-full bg-emerald-600 shadow-sm border border-emerald-500/20 ${className}`}>
        {/* Animated Circle Logo */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-3/5 h-3/5 text-white"
        >
          <path
            d="M12 4V20M4 12H20"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className={`text-gray-900 dark:text-white transition-colors ${textClassName}`}>
        Monstera
      </span>
    </div>
  );
}
