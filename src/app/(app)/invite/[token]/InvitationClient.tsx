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
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <section className="w-full max-w-md rounded-lg border border-line bg-panel p-8 shadow-xs">
        <Logo className="mb-6 h-8 w-8" textClassName="hidden" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Private agency pilot</p>
        <h1 className="mt-2 text-xl font-bold text-ink">
          {info ? `Join ${info.agencyName}` : "Agency invitation"}
        </h1>
        {info ? (
          <p className="mt-2 text-xs leading-5 text-ink-mute">
            Sign in as {info.emailHint} to join as {info.role}. This invitation expires {new Date(info.expiresAt).toLocaleDateString()}.
          </p>
        ) : !error ? (
          <div className="mt-6 flex items-center gap-2 text-xs text-ink-mute"><Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> Checking invitation…</div>
        ) : null}
        {error ? <p role="alert" className="mt-5 rounded-md border border-red-900/40 bg-red-950/30 p-3 text-xs text-red-200">{error}</p> : null}
        {info && signedIn ? (
          <button type="button" onClick={accept} disabled={busy} className="mt-7 flex w-full items-center justify-center rounded-md bg-white px-4 py-2.5 text-xs font-semibold text-black hover:bg-neutral-200 disabled:opacity-60 transition-colors shadow-xs">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept invitation"}
          </button>
        ) : info ? (
          <div className="mt-7 grid gap-3">
            <Link className="rounded-md bg-white px-4 py-2.5 text-center text-xs font-semibold text-black hover:bg-neutral-200 transition-colors shadow-xs" href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}>Sign in</Link>
            <Link className="rounded-md border border-line bg-canvas px-4 py-2.5 text-center text-xs font-semibold text-ink hover:bg-white/[0.06] transition-colors" href={`/register?invite=${encodeURIComponent(token)}`}>Create invited account</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
