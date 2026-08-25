"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyableBadgeProps {
  text: string;
  copyValue?: string;
  className?: string;
  title?: string;
  prefix?: string;
  children?: React.ReactNode;
}

export function CopyableBadge({
  text,
  copyValue,
  className,
  title,
  prefix,
  children,
}: CopyableBadgeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const toCopy = copyValue ?? text;
    navigator.clipboard.writeText(toCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      data-no-row-click
      title={title || `Click to copy "${copyValue || text}"`}
      className={cn(
        "group/copy relative inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded-md border border-line/80 bg-canvas px-2 py-0.5 font-mono text-[11px] font-medium text-ink transition-all hover:border-white/30 hover:bg-white/[0.04] cursor-pointer leading-tight",
        copied && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        className
      )}
    >
      {prefix && <span className="text-ink-mute/70 font-normal">{prefix}</span>}
      <span>{children || text}</span>
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400 shrink-0" />
      ) : (
        <Copy className="h-2.5 w-2.5 text-ink-mute/40 opacity-0 group-hover/copy:opacity-100 transition-opacity shrink-0" />
      )}
      {copied && (
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-neutral-900 border border-white/20 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300 shadow-xl pointer-events-none z-50 animate-in fade-in zoom-in-90 duration-150">
          Copied!
        </span>
      )}
    </button>
  );
}
