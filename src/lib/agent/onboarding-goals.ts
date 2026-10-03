export const ONBOARDING_GOALS = [
  { id: "performance", context: "Understand campaign performance", title: "Understand performance", description: "Start with a clear view of your campaign data.", prompt: "Which campaigns should I review first?" },
  { id: "reporting", context: "Prepare client reporting", title: "Prepare client reporting", description: "Check the sources behind your next client report.", prompt: "What data is available for my client report?" },
  { id: "spend", context: "Review advertising spend", title: "Review spend", description: "See advertising spend across your selected accounts.", prompt: "What did my selected accounts spend?" },
] as const;
export type OnboardingGoal = typeof ONBOARDING_GOALS[number]["id"];
export function onboardingGoal(context: string | null | undefined) {
  return ONBOARDING_GOALS.find(goal => goal.context === context) ?? null;
}
