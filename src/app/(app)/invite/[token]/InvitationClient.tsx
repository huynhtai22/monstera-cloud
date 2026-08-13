"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";

type InvitationInfo = { emailHint: string; agencyName: string; role: string; expiresAt: string };

export function InvitationClient({ token, signedIn }: { token: string; signedIn: boolean }) {
  const router = useRouter();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Invitation is unavailable");
        setInfo(body);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not accept invitation");
      localStorage.setItem("monstera-workspace-storage", JSON.stringify({ state: { activeWorkspaceId: body.workspaceId }, version: 0 }));
      router.push("/console?welcome=1");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not accept invitation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Logo className="mb-6 h-9 w-9" textClassName="hidden" />
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-700">Private agency pilot</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
          {info ? `Join ${info.agencyName}` : "Agency invitation"}
        </h1>
        {info ? (
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Sign in as {info.emailHint} to join as {info.role}. This invitation expires {new Date(info.expiresAt).toLocaleDateString()}.
          </p>
        ) : !error ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking invitation…</div>
        ) : null}
        {error ? <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {info && signedIn ? (
          <button type="button" onClick={accept} disabled={busy} className="mt-7 flex w-full items-center justify-center rounded-lg bg-cyan-700 px-4 py-3 font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Accept invitation"}
          </button>
        ) : info ? (
          <div className="mt-7 grid gap-3">
            <Link className="rounded-lg bg-cyan-700 px-4 py-3 text-center font-semibold text-white hover:bg-cyan-800" href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}>Sign in</Link>
            <Link className="rounded-lg border border-slate-300 px-4 py-3 text-center font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200" href={`/register?invite=${encodeURIComponent(token)}`}>Create invited account</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
