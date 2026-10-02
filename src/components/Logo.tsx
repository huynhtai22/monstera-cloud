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
      <image href="/logo-mark.svg" width="32" height="32" />
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
