import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPatient, getCurrentSession, getLanguage } from "@/lib/current";
import { getDictionary } from "@/lib/i18n";
import { LANGUAGES, type Language } from "@/lib/schema";
import { PageHeader } from "@/components/page-header";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; lang?: string }>;
}) {
  const { tab, lang } = await searchParams;
  const session = await getCurrentSession();

  // A signed-in patient may still come here to register a password (the
  // "Set a password now" button after onboarding). Anyone else who is
  // already signed in has nothing to do here.
  const registering = session?.role === "patient" && tab === "register";
  if (session && !registering) redirect("/");

  // ?lang= comes from the first screen's language buttons, so the choice
  // the person just made carries over to sign-in.
  const language = LANGUAGES.includes(lang as Language) ? (lang as Language) : await getLanguage();
  const t = getDictionary(language);
  const patient = registering ? await getCurrentPatient() : null;
  const initialTab = tab === "register" || tab === "family" ? tab : "signin";

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t.appName} subtitle={t.login.subtitle} />

      <LoginForm initialTab={initialTab} initialLanguage={language} knownPatientId={patient?.id} />

      {!session ? (
        <p className="mt-8 text-lg text-ink-muted">
          {t.login.newHere}{" "}
          <Link href="/onboarding" className="font-bold text-accent underline">
            {t.login.setUp}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
