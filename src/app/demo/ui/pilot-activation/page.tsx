import { notFound } from "next/navigation";
import { SetupWizard } from "@/components/dashboard/SetupWizard";
import type { PilotActivationState } from "@/lib/pilot-activation";

const trialEndsAt = "2026-09-10T00:00:00.000Z";

const fixtures: Array<{ label: string; activation: PilotActivationState }> = [
  {
    label: "Not started",
    activation: { status: "not_started", currentStep: "connect_source", trialEndsAt, sourceConnectionId: null, rows7d: 0, dataThroughDate: null, dashboardReviewedAt: null, blockers: [] },
  },
  {
    label: "Importing",
    activation: { status: "in_progress", currentStep: "import_data", trialEndsAt, sourceConnectionId: "fixture-source", rows7d: 0, dataThroughDate: null, dashboardReviewedAt: null, blockers: [] },
  },
  {
    label: "Blocked",
    activation: { status: "blocked", currentStep: "fix_source", trialEndsAt, sourceConnectionId: "fixture-source", rows7d: 0, dataThroughDate: null, dashboardReviewedAt: null, blockers: ["source_authorization_failed"] },
  },
  {
    label: "Ready to review",
    activation: { status: "ready_to_review", currentStep: "review_dashboard", trialEndsAt, sourceConnectionId: "fixture-source", rows7d: 1284, dataThroughDate: "2026-09-03T00:00:00.000Z", dashboardReviewedAt: null, blockers: [] },
  },
  {
    label: "Activated",
    activation: { status: "activated", currentStep: "complete", trialEndsAt, sourceConnectionId: "fixture-source", rows7d: 1284, dataThroughDate: "2026-09-03T00:00:00.000Z", dashboardReviewedAt: "2026-09-03T01:00:00.000Z", blockers: [] },
  },
];

export default function PilotActivationPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="min-h-screen bg-canvas p-4 text-ink sm:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div><p className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">Development fixture</p><h1 className="mt-2 text-2xl font-semibold">Pilot activation states</h1></div>
        {fixtures.map((fixture) => (
          <section key={fixture.label} className="space-y-2">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-mute">{fixture.label}</h2>
            <SetupWizard activation={fixture.activation} plan="professional" workspaceStatus="PILOT" />
          </section>
        ))}
      </div>
    </main>
  );
}
