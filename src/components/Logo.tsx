import React from "react";

export function LogoMark({
  className = "h-7 w-7",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="6.5" fill="#0C0C0C" stroke="#2B2B2B" strokeWidth="1.5" />
      <path
        d="M16 8V24M8 16H24"
        stroke="#EDEDED"
        strokeWidth="2.5"
        strokeLinecap="square"
      />
    </svg>
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
