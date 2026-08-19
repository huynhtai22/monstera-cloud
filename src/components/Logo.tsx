import React from "react";

export function LogoMark({
  className = "h-7 w-7",
}: {
  className?: string;
}) {
  return (
    <div
      className={`relative flex items-center justify-center rounded-md border border-black/10 bg-black/[0.04] dark:border-line dark:bg-panel ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[55%] w-[55%] text-gray-900 dark:text-ink"
        aria-hidden
      >
        <path
          d="M12 5V19M5 12H19"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="square"
        />
      </svg>
    </div>
  );
}

export function Logo({
  className = "h-7 w-7",
  textClassName = "text-[15px] font-semibold tracking-tight",
}: {
  className?: string;
  textClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={className} />
      <span className={`text-gray-900 dark:text-ink ${textClassName}`}>Monstera Cloud</span>
    </div>
  );
}
