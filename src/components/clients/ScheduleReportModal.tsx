"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Send, Clock, Check, Trash2, Mail, MessageSquare, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useMounted } from "@/hooks/useMounted";

export interface ReportScheduleData {
  id?: string;
  workspaceId: string;
  clientId?: string | null;
  cron: string;
  recipients: string;
  enabled: boolean;
  lastSentAt?: string | null;
}

interface ScheduleReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  client: { id: string; name: string } | null;
  initialSchedule?: ReportScheduleData | null;
  onSaved?: () => void;
}

const CRON_PRESETS = [
  { label: "Weekly on Monday (9:00 AM) — Recommended", cron: "0 9 * * 1" },
  { label: "Daily recap (8:00 AM)", cron: "0 8 * * *" },
  { label: "Friday weekly wrap (5:00 PM)", cron: "0 17 * * 5" },
];

export function ScheduleReportModal({
  isOpen,
  onClose,
  workspaceId,
  client,
  initialSchedule,
  onSaved,
}: ScheduleReportModalProps) {
  const mounted = useMounted();
  const [emails, setEmails] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [cron, setCron] = useState("0 9 * * 1");
  const [enabled, setEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (initialSchedule) {
      setCron(initialSchedule.cron || "0 9 * * 1");
      setEnabled(initialSchedule.enabled ?? true);

      // Parse existing recipients string
      const tokens = (initialSchedule.recipients || "").split(/[\n,;]+/).map((t) => t.trim());
      const emailList: string[] = [];
      let slack = "";
      let tg = "";

      for (const t of tokens) {
        if (t.startsWith("https://hooks.slack.com/") || t.startsWith("https://discord.com/")) {
          slack = t;
        } else if (t.startsWith("tg:") || t.startsWith("telegram:") || /^-?\d{6,}$/.test(t)) {
          tg = t.replace(/^(tg|telegram):/, "");
        } else if (t.includes("@")) {
          emailList.push(t);
        }
      }

      setEmails(emailList.join(", "));
      setSlackWebhook(slack);
      setTelegramChatId(tg);
    } else {
      setEmails("");
      setSlackWebhook("");
      setTelegramChatId("");
      setCron("0 9 * * 1");
      setEnabled(true);
    }
  }, [initialSchedule, isOpen]);

  const compileRecipientsString = () => {
    const parts: string[] = [];
    if (emails.trim()) parts.push(emails.trim());
    if (slackWebhook.trim()) parts.push(slackWebhook.trim());
    if (telegramChatId.trim()) parts.push(telegramChatId.trim());
    return parts.join(", ");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipients = compileRecipientsString();

    if (!recipients) {
      toast.error("Please provide at least one destination (email, Slack webhook, or Telegram ID)");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/report-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: initialSchedule?.id,
          workspaceId,
          clientId: client?.id,
          cron,
          recipients,
          enabled,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save schedule");
      }

      toast.success(initialSchedule ? "Report schedule updated!" : "Report schedule created!");
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestDispatch = async () => {
    const recipients = compileRecipientsString();
    if (!recipients) {
      toast.error("Enter at least one Slack webhook, Telegram chat ID, or email to test");
      return;
    }

    setIsTesting(true);
    try {
      const res = await fetch("/api/report-schedules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          clientId: client?.id,
          recipients,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Test dispatch failed");
      }

      const sentSummary = [];
      if (data.slackDelivered > 0) sentSummary.push("Slack ✓");
      if (data.telegramDelivered > 0) sentSummary.push("Telegram ✓");
      if (data.emailRecipients?.length > 0) sentSummary.push(`${data.emailRecipients.length} emails ✓`);

      toast.success(
        sentSummary.length > 0
          ? `Test brief sent: ${sentSummary.join(" · ")}`
          : "Test brief rendered successfully"
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!initialSchedule?.id) return;
    if (!confirm("Are you sure you want to remove this report schedule?")) return;

    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/report-schedules?id=${initialSchedule.id}&workspaceId=${workspaceId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete schedule");
      toast.success("Schedule removed");
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-lg rounded-xl border border-line bg-panel shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4 bg-canvas/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/20 text-accent">
                <Clock className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-base font-semibold text-ink">
                Automated Report Dispatch
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-ink-mute">
              {client ? `Brand: ${client.name}` : "Workspace-wide reporting digest"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-mute hover:bg-white/[0.06] hover:text-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 flex-1 overflow-y-auto">
          {/* Slack Webhook */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
              Slack Incoming Webhook URL
            </label>
            <input
              type="url"
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full rounded-lg border border-line bg-canvas/60 px-3 py-2 text-xs text-ink placeholder:text-ink-mute focus:border-accent focus:outline-hidden"
            />
            <p className="mt-1 text-[11px] text-ink-mute">
              Monstera posts a formatted executive brief directly into your client Slack channel.
            </p>
          </div>

          {/* Telegram Chat ID */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-blue-400" />
              Telegram Chat ID
            </label>
            <input
              type="text"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="-100123456789"
              className="w-full rounded-lg border border-line bg-canvas/60 px-3 py-2 text-xs text-ink placeholder:text-ink-mute focus:border-accent focus:outline-hidden"
            />
            <p className="mt-1 text-[11px] text-ink-mute">
              Group or channel ID. Monstera delivers the brief via your agency Telegram bot.
            </p>
          </div>

          {/* Email Recipients */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-purple-400" />
              Email Recipients (comma separated)
            </label>
            <input
              type="text"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="client@brand.com, manager@agency.com"
              className="w-full rounded-lg border border-line bg-canvas/60 px-3 py-2 text-xs text-ink placeholder:text-ink-mute focus:border-accent focus:outline-hidden"
            />
          </div>

          {/* Frequency Selector */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1.5">
              Dispatch Schedule
            </label>
            <div className="space-y-1.5">
              {CRON_PRESETS.map((p) => (
                <label
                  key={p.cron}
                  className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition ${
                    cron === p.cron
                      ? "border-accent bg-accent/10 text-ink font-medium"
                      : "border-line bg-canvas/40 text-ink-mute hover:border-line-strong hover:text-ink"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="cronPreset"
                      checked={cron === p.cron}
                      onChange={() => setCron(p.cron)}
                      className="text-accent"
                    />
                    <span>{p.label}</span>
                  </div>
                  <code className="text-[10px] text-ink-mute">{p.cron}</code>
                </label>
              ))}
            </div>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-line">
            <span className="text-xs font-medium text-ink">Schedule Status</span>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                enabled ? "bg-accent" : "bg-white/20"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-4.5" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Test Dispatch Bar */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-line text-xs">
            <div className="flex items-center gap-2 text-ink-mute">
              <AlertCircle className="w-4 h-4 text-accent shrink-0" />
              <span>Verify formatting before scheduling</span>
            </div>
            <button
              type="button"
              onClick={handleTestDispatch}
              disabled={isTesting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-ink text-xs font-medium transition disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {isTesting ? "Sending..." : "Send Test Brief"}
            </button>
          </div>

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-line">
            {initialSchedule ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg border border-line text-xs text-ink-mute hover:text-ink hover:border-line-strong transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition shadow-sm disabled:opacity-50 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                {isSaving ? "Saving..." : "Save Schedule"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
