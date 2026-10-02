"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  registerAction,
  signInAction,
  shareCodeAction,
  type LoginState,
} from "@/app/login/actions";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { LANGUAGES, LANGUAGE_LABELS, type Language } from "@/lib/schema";

type Tab = "signin" | "register" | "family";

const fieldClass = "w-full rounded-2xl border-2 border-line bg-surface-muted px-5 py-4 text-xl";

function SubmitButton({ pending, label, t }: { pending: boolean; label: string; t: Dictionary }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-touch items-center justify-center gap-3 rounded-2xl bg-accent px-6 py-5 text-2xl font-bold text-accent-ink disabled:opacity-70"
    >
      {pending ? (
        <>
          <Loader2 aria-hidden="true" className="size-7 animate-spin" />
          {t.common.pleaseWait}
        </>
      ) : (
        label
      )}
    </button>
  );
}

function ErrorNotice({ state, t }: { state: LoginState; t: Dictionary }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-2xl border-2 border-danger px-5 py-4 text-lg font-semibold text-danger">
      {t.login.errors[state.error] ?? t.login.errors.generic}
    </p>
  );
}

/**
 * Sign in, first-time registration, and family sign-in by share code.
 *
 * Nobody is signed in yet, so the language is picked right here with a
 * row of buttons at the top; it starts from the last language used on this
 * device (cookie) and switches every label instantly.
 */
export function LoginForm({
  initialTab = "signin",
  initialLanguage,
  knownPatientId,
}: {
  initialTab?: Tab;
  initialLanguage: Language;
  /** Set when a signed-in patient arrives to register (from /welcome). */
  knownPatientId?: string;
}) {
  // null until the user picks a tab themselves.
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = getDictionary(language);

  const [signinState, signinSubmit, signinPending] = useActionState<LoginState, FormData>(signInAction, undefined);
  const [registerState, registerSubmit, registerPending] = useActionState<LoginState, FormData>(
    registerAction,
    undefined,
  );
  const [familyState, familySubmit, familyPending] = useActionState<LoginState, FormData>(
    shareCodeAction,
    undefined,
  );

  // After a failed submit, show the tab whose form failed, so its error is
  // visible. Without JavaScript the page re-renders from scratch after the
  // POST, and would otherwise reopen on the default tab, hiding the error.
  const errorTab: Tab | null = registerState?.error
    ? "register"
    : familyState?.error
      ? "family"
      : signinState?.error
        ? "signin"
        : null;
  const tab = chosenTab ?? errorTab ?? initialTab;

  const tabs: { id: Tab; label: string }[] = [
    { id: "signin", label: t.login.signIn },
    { id: "register", label: t.login.register },
    { id: "family", label: t.login.family },
  ];

  return (
    <div className="flex flex-col gap-7" lang={language}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t.family.language}>
        {LANGUAGES.map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={language === code}
            onClick={() => setLanguage(code)}
            className={`rounded-full border-2 px-4 py-2 text-lg font-semibold ${
              language === code ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-muted"
            }`}
          >
            {LANGUAGE_LABELS[code]}
          </button>
        ))}
      </div>

      <div role="tablist" aria-label={t.login.method} className="flex gap-2">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-2xl border-2 px-3 py-3 text-lg font-bold ${
              tab === id ? "border-accent bg-teal-50 text-accent" : "border-line text-ink-muted hover:border-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "signin" ? (
        <form action={signinSubmit} className="flex flex-col gap-5">
          <div>
            <label htmlFor="signin-id" className="mb-2 block text-xl font-bold">
              {t.login.identifier}
            </label>
            <input
              id="signin-id"
              name="identifier"
              required
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="K7M2QX"
              aria-describedby="signin-id-hint"
              className={`${fieldClass} font-mono text-2xl tracking-[0.15em]`}
            />
            <p id="signin-id-hint" className="mt-2 text-base text-ink-muted">
              {t.login.identifierHint}
            </p>
          </div>
          <div>
            <label htmlFor="signin-password" className="mb-2 block text-xl font-bold">
              {t.login.password}
            </label>
            <input
              id="signin-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={fieldClass}
            />
          </div>
          <ErrorNotice state={signinState} t={t} />
          <SubmitButton pending={signinPending} label={t.login.signIn} t={t} />
        </form>
      ) : null}

      {tab === "register" ? (
        <form action={registerSubmit} className="flex flex-col gap-5">
          <p className="text-lg text-ink-muted">{t.login.registerIntro}</p>
          <div>
            <label htmlFor="register-id" className="mb-2 block text-xl font-bold">
              {t.login.patientId}
            </label>
            <input
              id="register-id"
              name="patientId"
              required
              autoComplete="username"
              spellCheck={false}
              defaultValue={knownPatientId}
              readOnly={Boolean(knownPatientId)}
              className={`${fieldClass} font-mono text-lg read-only:text-ink-muted`}
            />
          </div>
          <div>
            <label htmlFor="register-password" className="mb-2 block text-xl font-bold">
              {t.login.choosePassword}
            </label>
            <input
              id="register-password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              autoFocus={Boolean(knownPatientId)}
              className={fieldClass}
            />
            <p className="mt-2 text-base text-ink-muted">{t.login.min8}</p>
          </div>
          <div>
            <label htmlFor="register-confirm" className="mb-2 block text-xl font-bold">
              {t.login.typeAgain}
            </label>
            <input
              id="register-confirm"
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={fieldClass}
            />
          </div>
          <ErrorNotice state={registerState} t={t} />
          <SubmitButton pending={registerPending} label={t.login.register} t={t} />
        </form>
      ) : null}

      {tab === "family" ? (
        <form action={familySubmit} className="flex flex-col gap-5">
          <p className="text-lg text-ink-muted">{t.login.familyIntro}</p>
          <div>
            <label htmlFor="family-code" className="mb-2 block text-xl font-bold">
              {t.login.shareCode}
            </label>
            <input
              id="family-code"
              name="code"
              required
              maxLength={6}
              spellCheck={false}
              autoCapitalize="characters"
              className={`${fieldClass} text-center font-mono text-3xl tracking-[0.3em] uppercase`}
            />
          </div>
          <ErrorNotice state={familyState} t={t} />
          <SubmitButton pending={familyPending} label={t.common.continue} t={t} />
        </form>
      ) : null}
    </div>
  );
}
