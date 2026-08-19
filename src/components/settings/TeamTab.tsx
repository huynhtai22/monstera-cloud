"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

type Member = { id: string; userId: string; role: string; user: { name: string | null; email: string | null } };

export function TeamTab({ workspaceId, currentRole }: { workspaceId: string | null; currentRole?: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState("");
  const canManage = currentRole === "owner" || currentRole === "admin";

  const load = useCallback(async () => {
    if (!workspaceId || !canManage) return;
    const response = await fetch(`/api/workspaces/${workspaceId}/members`);
    if (response.ok) setMembers((await response.json()).members);
  }, [workspaceId, canManage]);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    setBusy(true);
    setInvitationUrl("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/workspaces/${workspaceId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return toast.error(body.error || "Could not create invitation");
    setInvitationUrl(body.invitationUrl);
    event.currentTarget.reset();
    toast.success("Invitation created");
  }

  if (!canManage) return <p className="text-sm text-slate-600">Owner or admin access is required to view workspace members.</p>;

  return (
    <div className="max-w-4xl space-y-6">
      <div><h3 className="flex items-center text-lg font-semibold text-ink"><Users className="mr-2 h-5 w-5 text-ink-mute" strokeWidth={1.5} />Team</h3><p className="mt-1 text-sm text-ink-mute">Invite agency staff. Clients remain records and cannot sign in.</p></div>
      <form onSubmit={invite} className="grid gap-3 rounded-lg border border-line bg-canvas p-4 sm:grid-cols-[1fr_150px_auto]">
        <input name="email" required type="email" aria-label="Staff email" placeholder="staff@agency.com" className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink" />
        <select name="role" aria-label="Workspace role" className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"><option value="member">Member</option><option value="viewer">Viewer</option>{currentRole === "owner" ? <option value="admin">Admin</option> : null}</select>
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}</button>
      </form>
      {invitationUrl ? <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><input readOnly className="min-w-0 flex-1 bg-transparent" value={invitationUrl} /><button onClick={() => navigator.clipboard.writeText(invitationUrl)} aria-label="Copy invitation"><Copy className="h-4 w-4" /></button></div> : null}
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {members.map((member) => <div key={member.id} className="flex items-center justify-between p-4"><div><p className="text-sm font-medium">{member.user.name || member.user.email}</p><p className="text-xs text-slate-500">{member.user.email}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize dark:bg-slate-800">{member.role}</span></div>)}
        {!members.length ? <p className="p-4 text-sm text-slate-500">No members found.</p> : null}
      </div>
    </div>
  );
}
