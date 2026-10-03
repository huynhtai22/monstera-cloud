import { OnboardingExperience } from "@/components/onboarding/OnboardingExperience";
import { onboardingPageData } from "@/lib/agent/onboarding-page";

export const metadata = { title: "Set up your workspace" };
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ workspaceId?: string }> }) {
  const query = await searchParams;
  return <OnboardingExperience boot={await onboardingPageData(undefined, query.workspaceId)} />;
}
