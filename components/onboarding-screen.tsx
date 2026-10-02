"use client";

import { useState } from "react";
import { getDictionary } from "@/lib/i18n";
import type { Language } from "@/lib/schema";
import { PageHeader } from "@/components/page-header";
import { OnboardingForm } from "@/components/onboarding-form";

/** Heading and form share one language, so both switch together. */
export function OnboardingScreen({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = getDictionary(language);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.onboarding.title} subtitle={t.onboarding.subtitle} />
      <OnboardingForm initialLanguage={initialLanguage} onLanguageChange={setLanguage} />
    </div>
  );
}
