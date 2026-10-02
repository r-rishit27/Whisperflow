"use client";

import { useState } from "react";
import Link from "next/link";
import { LogIn, Users } from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import type { Language } from "@/lib/schema";
import { PageHeader } from "@/components/page-header";
import { OnboardingForm } from "@/components/onboarding-form";

/**
 * The first screen anyone sees.
 *
 * Returning patients (a new phone, cleared browser) must never be made to
 * fill in their details again, so the very top offers sign-in before any
 * question is asked. Below it, the three onboarding questions for someone
 * new. Heading, sign-in card and form share one language and switch
 * together the moment a language is tapped.
 */
export function OnboardingScreen({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = getDictionary(language);

  return (
    <div className="mx-auto max-w-2xl" lang={language}>
      <section
        aria-labelledby="have-account"
        className="mb-10 rounded-3xl border-2 border-accent bg-teal-50 px-5 py-5 sm:px-6"
      >
        <h2 id="have-account" className="text-2xl font-bold text-accent">
          {t.onboarding.haveAccount}
        </h2>
        <p className="mt-1 text-lg text-ink">{t.onboarding.haveAccountBody}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Link
            href={`/login?lang=${language}`}
            className="flex min-h-touch items-center justify-center gap-3 rounded-2xl bg-accent px-6 py-4 text-xl font-bold text-accent-ink"
          >
            <LogIn aria-hidden="true" className="size-7" />
            {t.onboarding.signIn}
          </Link>
          <Link
            href={`/login?tab=family&lang=${language}`}
            className="flex min-h-touch items-center justify-center gap-2 rounded-2xl border-2 border-accent bg-surface px-5 py-4 text-lg font-semibold text-accent"
          >
            <Users aria-hidden="true" className="size-6" />
            {t.onboarding.forFamily}
          </Link>
        </div>
      </section>

      <PageHeader title={t.onboarding.title} subtitle={t.onboarding.subtitle} />
      <OnboardingForm initialLanguage={initialLanguage} onLanguageChange={setLanguage} />
    </div>
  );
}
