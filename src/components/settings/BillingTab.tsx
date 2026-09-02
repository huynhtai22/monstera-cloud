import { CreditCard } from "lucide-react";
import Link from "next/link";

export function BillingTab({ workspacePlan, workspaceStatus, workspaceId, subscriptionEndsAt, isOwner }: { workspacePlan: string; workspaceStatus?: string; workspaceId?: string; subscriptionEndsAt?: string | Date | null; isOwner: boolean }) {
  const paidThrough = subscriptionEndsAt ? new Date(subscriptionEndsAt) : null;
  const paidThroughLabel = paidThrough && !Number.isNaN(paidThrough.getTime())
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(paidThrough)
    : null;

  const isTrial = workspaceStatus === "PILOT";
  return <div className="max-w-3xl space-y-5"><div><h3 className="flex items-center text-lg font-semibold text-ink"><CreditCard className="mr-2 h-5 w-5 text-ink-mute" strokeWidth={1.5} />Billing</h3><p className="mt-1 text-sm text-ink-mute">Plans and connector access are assigned at the agency workspace level.</p></div><div className="rounded-lg border border-line bg-canvas p-6"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">Current workspace plan</p><p className="mt-1 text-xl font-semibold capitalize text-ink">{isTrial ? "Agency Pro free trial" : workspacePlan}</p>{paidThroughLabel ? <p className="mt-3 text-sm text-ink-mute">{isTrial ? <>Your seven-day trial ends <span className="font-medium text-ink">{paidThroughLabel}</span>. Upgrade before then to keep Agency Pro limits.</> : <>Paid access through <span className="font-medium text-ink">{paidThroughLabel}</span>. Renew before then to keep your Agency Pro limits.</>}</p> : <p className="mt-3 text-sm text-ink-mute">Your workspace is currently on its assigned plan. Paid domestic-transfer terms appear here after PayOS verifies payment.</p>}{isOwner && workspaceId ? <Link href={`/pricing?workspaceId=${encodeURIComponent(workspaceId)}`} className="mt-4 inline-flex rounded-md border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-white/[0.06]">Manage this workspace&apos;s plan</Link> : <p className="mt-4 text-sm text-ink-mute">Only the workspace owner can manage billing.</p>}</div></div>;
}
