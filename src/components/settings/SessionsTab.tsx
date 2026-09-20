"use client";

import { useCallback, useEffect, useState } from "react";
import { Laptop, LogOut, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";

type BrowserSession = {
  jti: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  graceEndsAt: string | null;
  deviceLabel: string | null;
  seenIp: boolean;
  current: boolean;
};

type SessionAllowance = {
  plan: string;
  activeLimit: number;
  graceSlots: number;
  graceDurationHours: number;
  hardLimit: number;
  activeCount: number;
  graceEndsAt: string | null;
};

type LoginEventRow = {
  method: string;
  createdAt: string;
  seenIp: boolean;
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "unknown";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * P1 seat-sharing hardening: the user sees every browser signed in as them
 * and can revoke anything they don't recognize. Sharing one login across a
 * team becomes visible — inviting teammates is the easy path instead.
 */
export function SessionsTab() {
  const [sessions, setSessions] = useState<BrowserSession[] | null>(null);
  const [allowance, setAllowance] = useState<SessionAllowance | null>(null);
  const [events, setEvents] = useState<LoginEventRow[] | null>(null);
  const [busyJti, setBusyJti] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [sessRes, evtRes] = await Promise.all([
        fetch("/api/auth/sessions"),
        fetch("/api/auth/login-events?days=30"),
      ]);
      if (sessRes.ok) {
        const sessionData = await sessRes.json();
        setSessions(sessionData.sessions ?? []);
        setAllowance(sessionData.allowance ?? null);
      }
      if (evtRes.ok) setEvents((await evtRes.json()).events ?? []);
    } catch {
      toast.error("Failed to load sessions");
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const revoke = async (jti: string, current: boolean) => {
    if (current && !confirm("Sign out this browser? You will be logged out.")) return;
    setBusyJti(jti);
    try {
      const res = await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jti }),
      });
      if (res.ok) {
        toast.success(current ? "Signed out — please sign in again" : "Session revoked");
        await fetchAll();
      } else {
        toast.error("Could not revoke session");
      }
    } catch {
      toast.error("Could not revoke session");
    } finally {
      setBusyJti(null);
    }
  };

  const revokeOthers = async () => {
    if (!confirm("Sign out all other browsers? They will need to sign in again.")) return;
    setBusyJti("all");
    try {
      const res = await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allOthers: true }),
      });
      if (res.ok) {
        toast.success("Other sessions signed out");
        await fetchAll();
      } else {
        toast.error("Could not sign out other sessions");
      }
    } catch {
      toast.error("Could not sign out other sessions");
    } finally {
      setBusyJti(null);
    }
  };

  const active = (sessions ?? []).filter((s) => !s.revokedAt);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h3 className="flex items-center text-lg font-semibold text-ink">
          <MonitorSmartphone className="mr-2 h-5 w-5 text-ink-mute" strokeWidth={1.5} />
          Sessions
        </h3>
        <p className="mt-1 text-sm text-ink-mute">
          Use your account across your own devices. Give each teammate a named account, then share data-source connections safely through the workspace.
        </p>
      </div>

      {allowance ? (
        <div className="rounded-lg border border-line bg-canvas p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Flexible device allowance</p>
              <p className="mt-1 text-xs leading-5 text-ink-mute">
                {allowance.activeLimit} active browsers are included for each named user. One additional browser may remain active for {allowance.graceDurationHours} hours before the oldest inactive browser is signed out.
              </p>
            </div>
            <span className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-ink">
              {allowance.activeCount} of {allowance.activeLimit} active
            </span>
          </div>
          {allowance.graceEndsAt ? (
            <p className="mt-3 text-xs font-medium text-amber-500">
              Temporary extra-device access ends {new Date(allowance.graceEndsAt).toLocaleString()}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-line bg-canvas p-5">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-sm font-medium text-ink">Active browsers ({active.length})</h4>
          {active.length > 1 ? (
            <button
              onClick={revokeOthers}
              disabled={busyJti === "all"}
              className="flex items-center rounded-md border border-line bg-panel px-3 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              <LogOut className="mr-2 h-4 w-4" strokeWidth={1.5} />
              Sign out others
            </button>
          ) : null}
        </div>
        {sessions === null ? (
          <p className="text-sm text-ink-mute">Loading…</p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {sessions.map((s) => (
              <div key={s.jti} className="flex items-center justify-between gap-3 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Laptop className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {s.current ? `This browser · ${s.deviceLabel ?? "device pending identification"}` : (s.deviceLabel ?? "Browser session")}
                      {s.revokedAt ? <span className="ml-2 text-xs font-normal text-ink-mute">(signed out)</span> : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      Last seen {relativeTime(s.lastSeenAt)} · signed in {relativeTime(s.createdAt)} · {s.seenIp ? "recognized network" : "network pending"}
                    </p>
                    {s.revokedAt && s.revokedReason ? (
                      <p className="mt-1 text-xs text-amber-500">
                        {s.revokedReason === "allowance_exceeded"
                          ? "Signed out after another browser exceeded the temporary allowance."
                          : s.revokedReason === "grace_expired"
                            ? "Signed out when the temporary extra-device window ended."
                            : "Signed out from account security settings."}
                      </p>
                    ) : null}
                  </div>
                </div>
                {!s.revokedAt ? (
                  <button
                    onClick={() => revoke(s.jti, s.current)}
                    disabled={busyJti === s.jti}
                    aria-label={s.current ? "Sign out this browser" : "Revoke browser session"}
                    className="shrink-0 rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-60"
                  >
                    {s.current ? "Sign out" : "Revoke"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-line bg-canvas p-5">
        <h4 className="mb-4 text-sm font-medium text-ink">Recent sign-ins (30 days)</h4>
        {events === null ? (
          <p className="text-sm text-ink-mute">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-ink-mute">No sign-ins recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {events.map((e, i) => (
              <div key={`${e.createdAt}-${i}`} className="flex items-center justify-between py-2.5">
                <p className="text-sm text-ink">{e.method}</p>
                <p className="text-xs text-slate-500">{relativeTime(e.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
