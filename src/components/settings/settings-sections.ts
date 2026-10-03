export const settingsSections = [
  { id: "overview", label: "Overview", group: "Workspace", description: "Find the right control for your workspace.", keywords: "home settings", scope: "Workspace" },
  { id: "workspace", label: "Workspace", group: "Workspace", description: "Workspace identity, access, and setup.", keywords: "name slug providers onboarding", scope: "Workspace" },
  { id: "clients", label: "Client scope", group: "Workspace", description: "Keep accounts assigned to the right client.", keywords: "clients accounts assignments portfolio", scope: "Workspace" },
  { id: "team", label: "People & roles", group: "Workspace", description: "Invite teammates and manage workspace access.", keywords: "team members invite permissions seats", scope: "Workspace" },
  { id: "alerts", label: "Alerts & data quality", group: "Reporting", description: "Set data rules and choose where alerts arrive.", keywords: "telegram notifications thresholds spend roas rules", scope: "Workspace" },
  { id: "api", label: "API & access keys", group: "Reporting", description: "Manage credentials for your reporting integrations.", keywords: "api keys rotate security looker sheets token", scope: "Workspace" },
  { id: "billing", label: "Plan & billing", group: "Administration", description: "Review your plan, limits, and payment history.", keywords: "billing subscription invoices payment usage polar", scope: "Workspace" },
  { id: "sessions", label: "Sign-in & sessions", group: "Personal", description: "Review devices signed in to your account.", keywords: "sessions devices login logout security", scope: "Your account" },
  { id: "appearance", label: "Appearance", group: "Personal", description: "Choose the console theme that works for you.", keywords: "theme dark light display preferences animation motion", scope: "This browser" },
] as const;
export type SettingsSectionId = typeof settingsSections[number]["id"];
