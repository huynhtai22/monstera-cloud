export type FeatureHighlight = { title: string; copy: string; link: string; path: string; label: string; artwork: 0 | 1 | 2 | 3 };

export const defaultHighlights: readonly FeatureHighlight[] = [
  { title: "Your tools. One clear view.", copy: "Bring advertising and commerce data into your workspace. You choose the sources and approve access.", link: "Explore sources", path: "/sources", artwork: 0, label: "CONNECTED TOOLS" },
  { title: "Keep each client in focus.", copy: "Group the accounts behind each client’s reporting. Keep the reporting scope clear as your portfolio grows.", link: "View clients", path: "/clients", artwork: 1, label: "CLIENT CONTEXT" },
  { title: "A fleet you stay in control of.", copy: "Follow source setup and operational issues in one place. Review and approve the scope of available ongoing checks before activation.", link: "Open operations", path: "/operations", artwork: 2, label: "YOUR OPERATIONAL FLEET" },
  { title: "Know what reached your report.", copy: "Review source coverage, reporting dates, and delivery evidence. Inspect the destination output before treating a report as verified.", link: "Review reports", path: "/reports", artwork: 3, label: "REPORTING CONFIDENCE" },
];


export type ReminderCampaign = { id: string; kind: "introduction" | "announcement"; highlights: readonly FeatureHighlight[]; roles?: readonly string[]; plans?: readonly string[]; startsAt?: string; endsAt?: string };

// IDs identify a message, not its copy/design revision. Add announcements only after availability and audience review.
export const reminderCampaigns: readonly ReminderCampaign[] = [
  { id: "console-introduction", kind: "introduction", highlights: defaultHighlights },
];
