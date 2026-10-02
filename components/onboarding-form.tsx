"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { LANGUAGES, LANGUAGE_LABELS, type Language } from "@/lib/schema";
import { getDictionary } from "@/lib/i18n";
import { completeOnboarding, type OnboardingState } from "@/app/onboarding/actions";

const LANGUAGE_SUBTITLES: Record<Language, string> = {
  en: "English",
  hi: "Hindi",
  te: "Telugu",
};

const fieldClass = "w-full rounded-2xl border-2 border-line bg-surface-muted px-5 py-4 text-xl";

/**
 * The whole screen switches language the moment one is tapped, so someone
 * who reads only Hindi or Telugu can understand the remaining questions.
 * The heading comes from the server; everything below it re-renders here.
 */
export function OnboardingForm({
  initialLanguage,
  onLanguageChange,
}: {
  initialLanguage: Language;
  onLanguageChange?: (language: Language) => void;
}) {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    completeOnboarding,
    undefined,
  );
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = getDictionary(language);

  function choose(code: Language) {
    setLanguage(code);
    onLanguageChange?.(code);
  }

  return (
    <form action={formAction} className="flex flex-col gap-8" lang={language}>
      <div>
        <label htmlFor="name" className="mb-2 block text-xl font-bold">
          {t.onboarding.name}
        </label>
        <input id="name" name="name" required maxLength={80} autoComplete="name" autoFocus className={fieldClass} />
      </div>

      <fieldset>
        <legend className="mb-3 text-xl font-bold">{t.onboarding.language}</legend>

        {/* The three buttons are the radio group: the inputs stay in the
            accessibility tree but are visually replaced by the labels. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {LANGUAGES.map((code) => {
            const selected = language === code;
            return (
              <label
                key={code}
                lang={code}
                className={`flex min-h-touch cursor-pointer items-center justify-between gap-4 rounded-2xl border-2 px-5 py-4 text-left ${
                  selected ? "border-accent bg-teal-50 text-accent" : "border-line bg-surface-muted hover:border-accent"
                }`}
              >
                <input
                  type="radio"
                  name="language"
                  value={code}
                  checked={selected}
                  onChange={() => choose(code)}
                  className="sr-only"
                />
                <span>
                  <span className="block text-2xl font-bold">{LANGUAGE_LABELS[code]}</span>
                  <span className="block text-base text-ink-muted">{LANGUAGE_SUBTITLES[code]}</span>
                </span>
                {selected ? <Check aria-hidden="true" className="size-8 shrink-0" strokeWidth={3} /> : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-xl font-bold">{t.onboarding.contact}</legend>
        <p className="-mt-2 text-base text-ink-muted">{t.onboarding.contactHint}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="caregiverName" className="mb-2 block text-lg font-semibold">
              {t.onboarding.theirName}
            </label>
            <input id="caregiverName" name="caregiverName" maxLength={80} className={fieldClass} />
          </div>

          <div>
            <label htmlFor="caregiverPhone" className="mb-2 block text-lg font-semibold">
              {t.onboarding.theirPhone}
            </label>
            <input
              id="caregiverPhone"
              name="caregiverPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {state?.error ? (
        <p role="alert" className="rounded-2xl border-2 border-danger px-5 py-4 text-lg font-semibold text-danger">
          {t.onboarding.errors[state.error]}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex min-h-touch items-center justify-center gap-3 rounded-2xl bg-accent px-6 py-5 text-2xl font-bold text-accent-ink disabled:opacity-70"
      >
        {pending ? (
          <>
            <Loader2 aria-hidden="true" className="size-7 animate-spin" />
            {t.common.saving}
          </>
        ) : (
          t.common.continue
        )}
      </button>
    </form>
  );
}
