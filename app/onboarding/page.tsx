import { redirect } from "next/navigation";
import { getCurrentSession, getLanguageFast } from "@/lib/current";
import { OnboardingScreen } from "@/components/onboarding-screen";

export default async function OnboardingPage() {
  // Onboarding is a one-time screen: anyone who already has a patient goes
  // straight to Today.
  if (await getCurrentSession()) redirect("/");

  return <OnboardingScreen initialLanguage={await getLanguageFast()} />;
}
