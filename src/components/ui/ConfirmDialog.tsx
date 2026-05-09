"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrimaryButton, SecondaryButton } from "./index";

const DIALOG_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const DIALOG_DURATION_MS = 280;

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const [shouldRender, setShouldRender] = useState(open);
  const [isVisible, setIsVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    setIsVisible(false);
    const t = setTimeout(() => setShouldRender(false), DIALOG_DURATION_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!shouldRender) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        !isVisible && "pointer-events-none"
      )}
      role="presentation"
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/60",
          "transition-opacity duration-200 ease-out",
          isVisible ? "opacity-100" : "opacity-0"
        )}
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className={cn(
          "relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-[#2f3336] dark:bg-[#000000]",
          "transition-all duration-[280ms]",
          isVisible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        )}
        style={{ transitionTimingFunction: DIALOG_EASE }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-[#16181c] dark:hover:text-white"
            aria-label={cancelLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p id="confirm-dialog-desc" className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {description}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <SecondaryButton onClick={onCancel}>
            {cancelLabel}
          </SecondaryButton>
          <PrimaryButton
            onClick={onConfirm}
            className={cn(
              variant === "danger" &&
                "bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 focus-visible:ring-red-500/40"
            )}
          >
            {confirmLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
