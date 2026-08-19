import { CreditCard } from "lucide-react";

export function BillingTab({ workspacePlan }: { workspacePlan: string }) {
  return <div className="max-w-3xl space-y-5"><div><h3 className="flex items-center text-lg font-semibold text-ink"><CreditCard className="mr-2 h-5 w-5 text-ink-mute" strokeWidth={1.5} />Pilot plan</h3><p className="mt-1 text-sm text-ink-mute">Plans and connector access are assigned at the agency workspace level.</p></div><div className="rounded-lg border border-line bg-canvas p-6"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">Current workspace plan</p><p className="mt-1 text-xl font-semibold capitalize text-ink">{workspacePlan}</p><p className="mt-4 text-sm text-ink-mute">Public checkout is not available during the private pilot. Contact the Monstera operator to change entitlements.</p></div></div>;
}
