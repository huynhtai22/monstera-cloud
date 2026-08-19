"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropdownOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
}

export function Dropdown({
  options,
  value,
  onChange,
  placeholder = "Select...",
  label,
  className,
  disabled = false,
  size = "md",
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const sizeClasses = {
    sm: "h-8 px-2.5 text-xs",
    md: "h-10 px-3 text-sm",
    lg: "h-12 px-4 text-base",
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-ink-mute">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border transition-colors duration-200",
          "bg-panel",
          "focus:outline-none focus:border-white/25",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          isOpen
            ? "border-white/25"
            : "border-line hover:border-white/20",
          sizeClasses[size]
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectedOption?.icon && (
            <span className="shrink-0 text-ink-mute">
              {selectedOption.icon}
            </span>
          )}
          <span
            className={cn(
              "truncate",
              selectedOption ? "text-ink" : "text-ink-mute"
            )}
          >
            {selectedOption?.label || placeholder}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "shrink-0 transition-transform duration-200",
            size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4",
            isOpen && "rotate-180",
            "text-ink-mute"
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full overflow-hidden rounded-md border",
            "bg-panel border-line"
          )}
        >
          <div className="max-h-60 overflow-y-auto py-1">
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                  "hover:bg-white/[0.04]",
                  value === option.value && "bg-white/[0.06]",
                  index !== options.length - 1 && "border-b border-line"
                )}
              >
                {/* Selection indicator */}
                <div
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded",
                    "border transition-colors",
                    value === option.value
                      ? "border-accent bg-accent text-primary-foreground"
                      : "border-line"
                  )}
                >
                  {value === option.value && <Check className="h-3 w-3" />}
                </div>

                {/* Icon */}
                {option.icon && (
                  <span className="shrink-0 text-gray-400 dark:text-slate-500">
                    {option.icon}
                  </span>
                )}

                {/* Label & Description */}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm",
                      value === option.value
                        ? "font-medium text-cyan-700 dark:text-cyan-300"
                        : "text-gray-700 dark:text-slate-300"
                    )}
                  >
                    {option.label}
                  </p>
                  {option.description && (
                    <p className="truncate text-xs text-gray-400 dark:text-slate-500">
                      {option.description}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Bottom gradient fade */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />
        </div>
      )}
    </div>
  );
}

// Multi-select variant
interface MultiDropdownProps {
  options: DropdownOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function MultiDropdown({
  options,
  values,
  onChange,
  placeholder = "Select...",
  label,
  className,
  disabled = false,
}: MultiDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleValue = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const displayText =
    values.length === 0
      ? placeholder
      : values.length === 1
        ? options.find((o) => o.value === values[0])?.label
        : `${values.length} selected`;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-ink-mute">
          {label}
        </label>
      )}

      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "flex w-full h-10 items-center justify-between gap-2 rounded-lg border px-3 transition-all",
          "bg-white dark:bg-[#000000]",
          "focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500/50",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          isOpen
            ? "border-cyan-500/50 shadow-lg shadow-cyan-500/10"
            : "border-gray-200 dark:border-[#2f3336] hover:border-gray-300 dark:hover:border-slate-600"
        )}
      >
        <span
          className={cn(
            "truncate text-sm",
            values.length > 0 ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-slate-500"
          )}
        >
          {displayText}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full overflow-hidden rounded-lg border",
            "bg-white dark:bg-[#000000]",
            "border-gray-200 dark:border-[#2f3336]",
            "shadow-xl"
          )}
        >
          <div className="max-h-60 overflow-y-auto py-1">
            {options.map((option) => {
              const isSelected = values.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleValue(option.value)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    "hover:bg-gray-50 dark:hover:bg-[#16181c]",
                    isSelected && "bg-cyan-50 dark:bg-cyan-950/30"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded",
                      "border transition-colors",
                      isSelected
                        ? "border-cyan-500 bg-cyan-500 text-white"
                        : "border-gray-300 dark:border-[#2f3336]"
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  {option.icon && (
                    <span className="shrink-0 text-gray-400">{option.icon}</span>
                  )}
                  <span
                    className={cn(
                      "text-sm",
                      isSelected
                        ? "font-medium text-cyan-700 dark:text-cyan-300"
                        : "text-gray-700 dark:text-slate-300"
                    )}
                  >
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
