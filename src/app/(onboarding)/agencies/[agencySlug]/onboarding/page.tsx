import { OnboardingExperience } from "@/components/onboarding/OnboardingExperience";
import { onboardingPageData } from "@/lib/agent/onboarding-page";

export const metadata = { title: "Set up your workspace" };
export default async function AgencyOnboardingPage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  return <OnboardingExperience boot={await onboardingPageData(agencySlug)} />;
}
