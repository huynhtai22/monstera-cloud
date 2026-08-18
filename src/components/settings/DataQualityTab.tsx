"use client";

import React, { useState, useEffect } from "react";
import {
  AlertTriangle,
  Plus,
  Trash2,
  CheckCircle2,
  Send,
  Sliders,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface DataQualityRule {
  id: string;
  name: string;
  ruleType: "threshold" | "comparison" | "schema_check";
  metric: "revenue" | "orders" | "roas" | "row_count" | "spend" | "conversions" | "impressions" | "clicks";
  operator: "gt" | "lt" | "eq" | "drop_pct" | "increase_pct" | "schema_check";
  threshold?: number | null;
  pctThreshold?: number | null;
  severity: "warning" | "critical";
  enabled: boolean;
  createdAt: string;
}

export interface DataQualityViolation {
  id: string;
  ruleId: string;
  expectedValue?: number | null;
  actualValue: number;
  pctChange?: number | null;
  status: string;
  createdAt: string;
}

export interface DataQualityTabProps {
  workspaceId: string;
  canManage: boolean;
  rules: DataQualityRule[];
  violations: DataQualityViolation[];
  telegramChatId: string;
  onRefresh: () => void;
}

export function DataQualityTab({
  workspaceId,
  canManage,
  rules,
  violations,
  telegramChatId: initialChatId,
  onRefresh,
}: DataQualityTabProps) {
  const [chatId, setChatId] = useState(initialChatId);
  const [isSavingChatId, setIsSavingChatId] = useState(false);
  const [isCreatingRule, setIsCreatingRule] = useState(false);

  // Sync state when initialChatId updates from server
  useEffect(() => {
    setChatId(initialChatId);
  }, [initialChatId]);

  // New Rule Form State
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<DataQualityRule["metric"]>("spend");
  const [operator, setOperator] = useState<DataQualityRule["operator"]>("gt");
  const [threshold, setThreshold] = useState<string>("500");
  const [pctThreshold, setPctThreshold] = useState<string>("0.3");
  const [severity, setSeverity] = useState<DataQualityRule["severity"]>("critical");

  const handleSaveTelegram = async () => {
    if (!canManage) return;
    setIsSavingChatId(true);
    try {
      const res = await fetch("/api/settings/data-quality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, telegramChatId: chatId }),
      });
      if (res.ok) {
        toast.success("Telegram alert settings saved");
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save Telegram settings");
      }
    } catch {
      toast.error("Network error saving Telegram settings");
    } finally {
      setIsSavingChatId(false);
    }
  };

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    if (!canManage) return;
    try {
      const res = await fetch("/api/settings/data-quality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, ruleId, enabled }),
      });
      if (res.ok) {
        toast.success(enabled ? "Rule enabled" : "Rule paused");
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to update rule status");
      }
    } catch {
      toast.error("Failed to toggle rule");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!canManage || !confirm("Are you sure you want to delete this rule?")) return;
    try {
      const res = await fetch(
        `/api/settings/data-quality?workspaceId=${encodeURIComponent(
          workspaceId
        )}&ruleId=${encodeURIComponent(ruleId)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        toast.success("Rule deleted");
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to delete rule");
      }
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !name.trim()) return;

    const isComparison = operator === "drop_pct" || operator === "increase_pct";
    const ruleType = isComparison ? "comparison" : operator === "schema_check" ? "schema_check" : "threshold";

    try {
      const res = await fetch("/api/settings/data-quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: name.trim(),
          ruleType,
          metric,
          operator,
          threshold: isComparison ? undefined : parseFloat(threshold),
          pctThreshold: isComparison ? parseFloat(pctThreshold) : undefined,
          severity,
        }),
      });

      if (res.ok) {
        toast.success("Anomaly rule created");
        setName("");
        setIsCreatingRule(false);
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to create rule");
      }
    } catch {
      toast.error("Failed to create rule");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Telegram Alert Notification Channel */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-[#2f3336] dark:bg-[#16181c]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                Telegram Incident Alerts
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Receive real-time instant alerts when critical data quality violations or pipeline errors occur.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="e.g. -1001234567890 (Channel/Group or User ID)"
              disabled={!canManage}
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm text-gray-900 focus:border-cyan-500 focus:bg-white focus:outline-none dark:border-[#2f3336] dark:bg-[#000000] dark:text-white"
            />
          </div>
          {canManage && (
            <button
              onClick={handleSaveTelegram}
              disabled={isSavingChatId}
              className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 disabled:opacity-50"
            >
              {isSavingChatId ? "Saving…" : "Save Alert Target"}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Tip: Add your bot to a Telegram channel and paste the Chat ID here to broadcast alerts to your operations team.
        </p>
      </div>

      {/* Anomaly & Data Quality Rules */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-[#2f3336] dark:bg-[#16181c]">
        <div className="flex items-center justify-between gap-4 mb-6 border-b border-gray-100 pb-4 dark:border-[#2f3336]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                Data Quality & Anomaly Rules
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Automated threshold checks executed after every pipeline run and warehouse sync.
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setIsCreatingRule(!isCreatingRule)}
              className="flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <Plus className="h-4 w-4" />
              {isCreatingRule ? "Cancel" : "New Rule"}
            </button>
          )}
        </div>

        {/* Create Rule Form */}
        {isCreatingRule && (
          <form
            onSubmit={handleCreateRule}
            className="mb-6 rounded-xl border border-amber-200 bg-amber-50/40 p-5 dark:border-amber-900/50 dark:bg-amber-950/20"
          >
            <h3 className="mb-4 text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-600" />
              Define Anomaly Rule
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Rule Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Daily Spend Exceeds $1,000"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none dark:border-[#2f3336] dark:bg-[#16181c] dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Metric
                </label>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as any)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none dark:border-[#2f3336] dark:bg-[#16181c] dark:text-white"
                >
                  <option value="spend">Ad Spend (Daily)</option>
                  <option value="revenue">Net Revenue</option>
                  <option value="row_count">Row Count (Sync volume)</option>
                  <option value="roas">ROAS (Return on Ad Spend)</option>
                  <option value="orders">Order Volume</option>
                  <option value="conversions">Conversions</option>
                  <option value="impressions">Impressions</option>
                  <option value="clicks">Clicks</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Condition / Operator
                </label>
                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as any)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none dark:border-[#2f3336] dark:bg-[#16181c] dark:text-white"
                >
                  <option value="gt">Greater Than (&gt; hard threshold)</option>
                  <option value="lt">Less Than (&lt; minimum threshold)</option>
                  <option value="eq">Equals (= exact threshold check)</option>
                  <option value="drop_pct">Drops by &gt; X% vs Previous Day</option>
                  <option value="increase_pct">Spikes by &gt; X% vs Previous Day</option>
                  <option value="schema_check">Schema Drift &amp; Missing Columns Check</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {operator === "drop_pct" || operator === "increase_pct"
                    ? "Percentage Threshold (e.g. 0.3 = 30%)"
                    : "Value Threshold"}
                </label>
                {operator === "drop_pct" || operator === "increase_pct" ? (
                  <input
                    type="number"
                    step="0.05"
                    min="0.01"
                    max="1.0"
                    required
                    value={pctThreshold}
                    onChange={(e) => setPctThreshold(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none dark:border-[#2f3336] dark:bg-[#16181c] dark:text-white"
                  />
                ) : (
                  <input
                    type="number"
                    step="any"
                    required
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none dark:border-[#2f3336] dark:bg-[#16181c] dark:text-white"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Alert Severity
                </label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none dark:border-[#2f3336] dark:bg-[#16181c] dark:text-white"
                >
                  <option value="critical">Critical (Instant Telegram Alert)</option>
                  <option value="warning">Warning (Audit log only)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreatingRule(false)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700"
              >
                Save Rule
              </button>
            </div>
          </form>
        )}

        {/* Rules Table */}
        {rules.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            <ShieldCheck className="mx-auto h-8 w-8 text-gray-400 mb-2 opacity-50" />
            No anomaly rules configured yet. Create a rule to monitor spend, zero-row syncs, or revenue drops.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-[#2f3336]">
            {rules.map((rule) => {
              const isComparison =
                rule.operator === "drop_pct" || rule.operator === "increase_pct";
              return (
                <div
                  key={rule.id}
                  className="flex items-center justify-between py-3.5 gap-4"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-2.5 w-2.5 rounded-full shrink-0",
                        rule.enabled ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"
                      )}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {rule.name}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                            rule.severity === "critical"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                          )}
                        >
                          {rule.severity}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Metric: <span className="font-mono text-gray-700 dark:text-gray-300">{rule.metric}</span> ·{" "}
                        Condition:{" "}
                        <span className="font-mono text-gray-700 dark:text-gray-300">
                          {rule.operator}{" "}
                          {isComparison
                            ? `${((rule.pctThreshold || 0) * 100).toFixed(0)}%`
                            : rule.threshold}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {canManage && (
                      <>
                        <button
                          onClick={() => handleToggleRule(rule.id, !rule.enabled)}
                          className={cn(
                            "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                            rule.enabled
                              ? "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-[#1d1f23] dark:text-gray-300"
                              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400"
                          )}
                        >
                          {rule.enabled ? "Pause" : "Enable"}
                        </button>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 transition"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Violation Incidents */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-[#2f3336] dark:bg-[#16181c]">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              Incident &amp; Violation History
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Audit log of all detected threshold violations.
            </p>
          </div>
        </div>

        {violations.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            No active violations. All data syncs within normal parameters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 dark:border-[#2f3336] text-gray-400">
                <tr>
                  <th className="py-2.5 font-medium">Timestamp</th>
                  <th className="py-2.5 font-medium">Actual Value</th>
                  <th className="py-2.5 font-medium">Expected</th>
                  <th className="py-2.5 font-medium">Change</th>
                  <th className="py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#2f3336]">
                {violations.map((v) => (
                  <tr key={v.id}>
                    <td className="py-2.5 text-gray-600 dark:text-gray-300">
                      {new Date(v.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 font-mono font-semibold text-rose-600 dark:text-rose-400">
                      {v.actualValue}
                    </td>
                    <td className="py-2.5 font-mono text-gray-500">
                      {v.expectedValue ?? "N/A"}
                    </td>
                    <td className="py-2.5 text-gray-500">
                      {v.pctChange !== null && v.pctChange !== undefined
                        ? `${(v.pctChange * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="py-2.5">
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                        {v.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
