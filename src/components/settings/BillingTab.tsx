import { CreditCard } from "lucide-react";

export function BillingTab({ workspacePlan }: { workspacePlan: string }) {
  return <div className="max-w-3xl space-y-5"><div><h3 className="flex items-center text-lg font-semibold"><CreditCard className="mr-2 h-5 w-5 text-cyan-600" />Pilot plan</h3><p className="mt-1 text-sm text-slate-500">Plans and connector access are assigned at the agency workspace level.</p></div><div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><p className="text-sm text-slate-500">Current workspace plan</p><p className="mt-1 text-xl font-semibold capitalize">{workspacePlan}</p><p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Public checkout is not available during the private pilot. Contact the Monstera operator to change entitlements.</p></div></div>;
}
