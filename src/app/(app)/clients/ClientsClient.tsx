"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Plus, X, Briefcase, LineChart, DatabaseZap, Calendar, Mail, Trash2, Pencil } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";

type ClientRow = {
    id: string;
    name: string;
    description?: string | null;
    logoUrl?: string | null;
    workspaceId: string;
    createdAt: string;
    updatedAt: string;
    isDemo?: boolean;
    _count?: { pipelines?: number; connections?: number };
};

type ReportSchedule = {
    id: string;
    workspaceId: string;
    clientId: string | null;
    cron: string;
    recipients: string;
    enabled: boolean;
    lastSentAt: string | null;
    createdAt: string;
    updatedAt: string;
};

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load");
    return data;
};

function initials(name: string): string {
    return name
        .split(" ")
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();
}

export function ClientsClient() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { mutate } = useSWRConfig();

    const clientsKey = activeWorkspaceId ? `/api/clients?workspaceId=${activeWorkspaceId}` : null;
    const { data: clients, error, isLoading } = useSWR<ClientRow[]>(clientsKey, fetcher);

    const schedulesKey = activeWorkspaceId ? `/api/report-schedules?workspaceId=${activeWorkspaceId}` : null;
    const { data: schedules } = useSWR<ReportSchedule[]>(schedulesKey, fetcher);

    const { data: workspaces } = useSWR("/api/workspaces", fetcher);
    const activeWorkspace = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return null;
        return workspaces.find((w: { id: string }) => w.id === activeWorkspaceId) ?? null;
    }, [workspaces, activeWorkspaceId]);

    const [formOpen, setFormOpen] = React.useState(false);
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [name, setName] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [logoUrl, setLogoUrl] = React.useState("");
    const [saving, setSaving] = React.useState(false);

    const [scheduleClientId, setScheduleClientId] = React.useState<string | null>(null);
    const [scheduleRecipients, setScheduleRecipients] = React.useState("");
    const [savingSchedule, setSavingSchedule] = React.useState(false);

    const resetForm = () => {
        setEditingId(null);
        setName("");
        setDescription("");
        setLogoUrl("");
    };

    const openCreate = () => {
        resetForm();
        setFormOpen(true);
    };

    const openEdit = (c: ClientRow) => {
        setEditingId(c.id);
        setName(c.name);
        setDescription(c.description ?? "");
        setLogoUrl(c.logoUrl ?? "");
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        resetForm();
    };

    const saveClient = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeWorkspaceId || !name.trim()) return;
        setSaving(true);
        try {
            if (editingId) {
                const res = await fetch("/api/clients", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: editingId,
                        workspaceId: activeWorkspaceId,
                        name: name.trim(),
                        description: description.trim() || null,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || "Failed to update client");
                toast.success("Client updated.");
            } else {
                const res = await fetch("/api/clients", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        workspaceId: activeWorkspaceId,
                        name: name.trim(),
                        description: description.trim() || undefined,
                        logoUrl: logoUrl.trim() || undefined,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || "Failed to create client");
                toast.success(`Client “${data.name}” created.`);
            }
            await mutate(clientsKey);
            closeForm();
        } catch (err: any) {
            toast.error(err?.message || "Could not save client.");
        } finally {
            setSaving(false);
        }
    };

    const deleteClient = async (c: ClientRow) => {
        if (!activeWorkspaceId) return;
        if (!window.confirm(`Delete client “${c.name}”? This won't delete their sources or pipelines, just the grouping.`)) return;
        try {
            const res = await fetch(
                `/api/clients?id=${encodeURIComponent(c.id)}&workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
                { method: "DELETE" }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Failed to delete client");
            toast.success("Client deleted.");
            await mutate(clientsKey);
        } catch (err: any) {
            toast.error(err?.message || "Could not delete client.");
        }
    };

    const scheduleByClient = React.useMemo(() => {
        const m = new Map<string, ReportSchedule>();
        for (const s of schedules ?? []) {
            if (s.clientId) m.set(s.clientId, s);
        }
        return m;
    }, [schedules]);

    const openScheduleFor = (clientId: string) => {
        const existing = scheduleByClient.get(clientId);
        setScheduleClientId(clientId);
        setScheduleRecipients(existing?.recipients ?? "");
    };

    const closeSchedule = () => {
        setScheduleClientId(null);
        setScheduleRecipients("");
    };

    const saveSchedule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeWorkspaceId || !scheduleClientId) return;
        const recipients = scheduleRecipients
            .split(/[,\n;]/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (recipients.length === 0) {
            toast.error("Add at least one recipient email.");
            return;
        }
        setSavingSchedule(true);
        try {
            const res = await fetch("/api/report-schedules", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    workspaceId: activeWorkspaceId,
                    clientId: scheduleClientId,
                    recipients: recipients.join(","),
                    cron: "0 9 * * 1", // Monday 09:00 UTC
                    enabled: true,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Failed to save schedule");
            toast.success("Weekly report scheduled — first send next Monday 09:00 UTC.");
            await mutate(schedulesKey);
            closeSchedule();
        } catch (err: any) {
            toast.error(err?.message || "Could not save schedule.");
        } finally {
            setSavingSchedule(false);
        }
    };

    const pauseSchedule = async (scheduleId: string, nextEnabled: boolean) => {
        try {
            const res = await fetch("/api/report-schedules", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: scheduleId, enabled: nextEnabled }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed");
            }
            toast.success(nextEnabled ? "Schedule resumed." : "Schedule paused.");
            await mutate(schedulesKey);
        } catch (err: any) {
            toast.error(err?.message || "Could not update schedule.");
        }
    };

    const deleteSchedule = async (scheduleId: string) => {
        if (!window.confirm("Remove this weekly report schedule?")) return;
        try {
            const res = await fetch(`/api/report-schedules?id=${encodeURIComponent(scheduleId)}`, {
                method: "DELETE",
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed");
            }
            toast.success("Schedule removed.");
            await mutate(schedulesKey);
        } catch (err: any) {
            toast.error(err?.message || "Could not remove schedule.");
        }
    };

    return (
        <PageShell>
            <div className="relative z-10 mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight text-ink">Clients</h1>
                    <p className="mt-1 text-sm text-ink-mute">
                        {activeWorkspace
                            ? `${clients?.length ?? 0} client${(clients?.length ?? 0) === 1 ? "" : "s"} · group sources by brand`
                            : "Group sources by the brand you serve."}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                    New client
                </button>
            </div>

            {isLoading ? (
                <div className="py-16 text-center text-sm text-gray-500 dark:text-slate-400">Loading clients…</div>
            ) : error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200">
                    Failed to load clients.
                </div>
            ) : !clients || clients.length === 0 ? (
                <EmptyState
                    icon={<Briefcase />}
                    title="No clients yet"
                    description="Create your first client to group their sources, pipelines, and weekly report deliveries."
                    primaryAction={
                        <button
                            type="button"
                            onClick={openCreate}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                        >
                            <Plus className="h-4 w-4" />
                            Add a client
                        </button>
                    }
                />
            ) : (
                <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:h-full">
                    {clients.map((c) => {
                        const schedule = scheduleByClient.get(c.id);
                        const pipelineCount = c._count?.pipelines ?? 0;
                        const connectionCount = c._count?.connections ?? 0;
                        return (
                            <div
                                key={c.id}
                                className="group relative flex flex-col rounded-lg border border-line bg-panel p-5 governed-hover"
                            >
                                <div className="mb-3 flex items-center gap-3">
                                    {c.logoUrl ? (
                                        <Image
                                            src={c.logoUrl}
                                            alt={`${c.name} logo`}
                                            width={40}
                                            height={40}
                                            unoptimized
                                            className="h-10 w-10 rounded-xl object-cover ring-1 ring-gray-200 dark:ring-slate-700"
                                        />
                                    ) : (
                                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-canvas text-sm font-semibold text-ink">
                                            {initials(c.name) || "?"}
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <h3 className="truncate text-base font-semibold text-ink">{c.name}</h3>
                                            {c.isDemo ? (
                                                <span className="inline-flex items-center rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-800 dark:bg-violet-950/80 dark:text-violet-200">
                                                    Demo
                                                </span>
                                            ) : null}
                                        </div>
                                        {c.description ? (
                                            <p className="mt-0.5 truncate text-xs text-ink-mute">{c.description}</p>
                                        ) : (
                                            <p className="mt-0.5 text-xs text-ink-mute">No description</p>
                                        )}
                                    </div>
                                </div>

                                <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
                                    <div className="flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1.5">
                                        <DatabaseZap className="h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} />
                                        <span className="font-semibold text-ink">{connectionCount}</span>
                                        <span className="text-ink-mute">source{connectionCount === 1 ? "" : "s"}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1.5">
                                        <LineChart className="h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} />
                                        <span className="font-semibold text-ink">{pipelineCount}</span>
                                        <span className="text-ink-mute">pipeline{pipelineCount === 1 ? "" : "s"}</span>
                                    </div>
                                </div>

                                {schedule ? (
                                    <div
                                        className={cn(
                                            "mb-4 rounded-lg border px-3 py-2 text-xs",
                                            schedule.enabled
                                                ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-200"
                                                : "border-gray-200 bg-gray-50 text-gray-600 dark:border-[#2f3336] dark:bg-[#000000]/60 dark:text-slate-400"
                                        )}
                                    >
                                        <div className="flex items-center gap-1.5 font-semibold">
                                            <Calendar className="h-3.5 w-3.5" />
                                            {schedule.enabled ? "Weekly report: Mon 09:00 UTC" : "Weekly report paused"}
                                        </div>
                                        <div className="mt-0.5 truncate text-[11px] opacity-90">{schedule.recipients}</div>
                                    </div>
                                ) : null}

                                <div className="mt-auto flex flex-wrap items-center gap-2">
                                    <Link
                                        href={`/reports?clientId=${encodeURIComponent(c.id)}`}
                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#000000]/70 dark:text-slate-200 dark:hover:bg-[#1d1f23]"
                                    >
                                        <LineChart className="h-3.5 w-3.5" />
                                        Reports
                                    </Link>
                                    {!c.isDemo ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => openScheduleFor(c.id)}
                                                className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.04]"
                                            >
                                                <Mail className="h-3.5 w-3.5" />
                                                {schedule ? "Edit schedule" : "Schedule email"}
                                            </button>
                                            {schedule ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => pauseSchedule(schedule.id, !schedule.enabled)}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#000000]/70 dark:text-slate-200 dark:hover:bg-[#1d1f23]"
                                                    >
                                                        {schedule.enabled ? "Pause" : "Resume"}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteSchedule(schedule.id)}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:bg-[#000000]/70 dark:text-red-300 dark:hover:bg-red-950/30"
                                                        aria-label="Remove schedule"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </>
                                            ) : null}
                                            <div className="ml-auto flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(c)}
                                                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#000000]/70 dark:text-slate-200 dark:hover:bg-[#1d1f23]"
                                                    aria-label="Edit client"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => deleteClient(c)}
                                                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:bg-[#000000]/70 dark:text-red-300 dark:hover:bg-red-950/30"
                                                    aria-label="Delete client"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <span className="ml-auto text-[11px] italic text-gray-400 dark:text-slate-500">
                                            Demo — toggle off in Settings to edit
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {formOpen ? (
                <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
                    <form
                        onSubmit={saveClient}
                        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-[#2f3336] dark:bg-[#000000]"
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                                {editingId ? "Edit client" : "New client"}
                            </h2>
                            <button
                                type="button"
                                onClick={closeForm}
                                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-[#16181c]"
                                aria-label="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <label className="mb-3 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                            Name <span className="text-red-600">*</span>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Aurora Retail VN"
                                required
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-100"
                            />
                        </label>

                        <label className="mb-3 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                            Description
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                placeholder="e.g. Fashion & lifestyle, Meta + Google Ads"
                                className="mt-1 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-100"
                            />
                        </label>

                        {!editingId ? (
                            <label className="mb-4 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                                Logo URL (optional)
                                <input
                                    type="url"
                                    value={logoUrl}
                                    onChange={(e) => setLogoUrl(e.target.value)}
                                    placeholder="https://..."
                                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-100"
                                />
                            </label>
                        ) : null}

                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeForm}
                                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-200 dark:hover:bg-[#1d1f23]"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving || !name.trim()}
                                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
                            >
                                {saving ? "Saving…" : editingId ? "Save changes" : "Create client"}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}

            {scheduleClientId ? (
                <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
                    <form
                        onSubmit={saveSchedule}
                        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-[#2f3336] dark:bg-[#000000]"
                    >
                        <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Weekly report schedule</h2>
                            <button
                                type="button"
                                onClick={closeSchedule}
                                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-[#16181c]"
                                aria-label="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <p className="mb-4 text-xs text-gray-600 dark:text-slate-400">
                            We’ll email a rolled-up sync summary every Monday at 09:00 UTC.
                        </p>

                        <label className="mb-4 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                            Recipients (comma-separated)
                            <textarea
                                value={scheduleRecipients}
                                onChange={(e) => setScheduleRecipients(e.target.value)}
                                rows={3}
                                placeholder="client@brand.com, you@agency.com"
                                className="mt-1 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-100"
                            />
                        </label>

                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeSchedule}
                                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-200 dark:hover:bg-[#1d1f23]"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={savingSchedule || !scheduleRecipients.trim()}
                                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
                            >
                                {savingSchedule ? "Saving…" : "Save schedule"}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}
        </PageShell>
    );
}
