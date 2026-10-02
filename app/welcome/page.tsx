import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPatient, getCurrentSession } from "@/lib/current";
import { getDictionary } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";

/**
 * Shown once, straight after onboarding: the two codes the patient needs to
 * keep. The patient ID is what they register a password against; the share
 * code is what family use to follow along.
 */
export default async function WelcomePage() {
  if (!(await getCurrentSession())) redirect("/onboarding");

  const patient = await getCurrentPatient();
  if (!patient) redirect("/onboarding");

  const t = getDictionary(patient.language);
  const firstName = patient.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.welcome.allSet(firstName)} subtitle={t.welcome.writeDown} />

      <dl className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border-2 border-line bg-surface-muted px-5 py-5">
          <dt className="text-lg font-semibold text-ink-muted">{t.welcome.patientId}</dt>
          <dd className="mt-2 font-mono text-xl break-all">{patient.id}</dd>
          <p className="mt-3 text-base text-ink-muted">{t.welcome.patientIdHint}</p>
        </div>

        <div className="rounded-2xl border-2 border-line bg-surface-muted px-5 py-5">
          <dt className="text-lg font-semibold text-ink-muted">{t.welcome.shareCode}</dt>
          <dd className="mt-2 font-mono text-3xl tracking-[0.2em]">{patient.share_code}</dd>
          <p className="mt-3 text-base text-ink-muted">{t.welcome.shareHint(patient.caregiver_name)}</p>
        </div>
      </dl>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Link
          href="/"
          className="flex min-h-touch items-center justify-center rounded-2xl bg-accent px-6 py-5 text-2xl font-bold text-accent-ink"
        >
          {t.welcome.goToday}
        </Link>
        <Link
          href="/login?tab=register"
          className="flex min-h-touch items-center justify-center rounded-2xl border-2 border-accent px-6 py-5 text-xl font-bold text-accent"
        >
          {t.welcome.setPassword}
        </Link>
      </div>
    </div>
  );
}
