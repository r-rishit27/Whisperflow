import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Check, LogOut } from "lucide-react";
import { getCurrentPatient, getCurrentSession } from "@/lib/current";
import { getTodayDoses } from "@/lib/data";
import { getDictionary } from "@/lib/i18n";
import { getOrigin } from "@/lib/origin";
import { LANGUAGES, LANGUAGE_LABELS, MISSED_ALERT_THRESHOLD } from "@/lib/schema";
import { PageHeader } from "@/components/page-header";
import { SharePanel } from "@/components/family/share-panel";
import { SubmitButton } from "@/components/submit-button";
import { changeLanguage } from "@/app/family/actions";
import { signOutAction } from "@/app/login/actions";

export default async function FamilyTab() {
  const session = await getCurrentSession();
  if (!session) redirect("/onboarding");

  const [patient, doses] = await Promise.all([
    getCurrentPatient(),
    getTodayDoses(session.patientId, session.role),
  ]);
  if (!patient) redirect("/login");

  const t = getDictionary(patient.language);
  const firstName = patient.name.split(" ")[0];
  const link = `${await getOrigin()}/family/${patient.share_code}`;

  const signOut = (
    <form action={signOutAction} className="mt-8">
      <SubmitButton
        pendingLabel={t.common.pleaseWait}
        className="flex min-h-touch w-full items-center justify-center gap-3 rounded-2xl border-2 border-line px-6 py-4 text-xl font-semibold text-ink-muted hover:bg-surface-muted"
      >
        <LogOut aria-hidden="true" className="size-6" />
        {t.family.signOut}
      </SubmitButton>
    </form>
  );

  // Family members signed in with the code just get the dashboard.
  if (session.role !== "patient") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t.family.title} />
        <Link
          href={`/family/${patient.share_code}`}
          className="flex min-h-touch items-center justify-center rounded-2xl bg-accent px-6 py-5 text-xl font-bold text-accent-ink"
        >
          {t.family.openDashboard(firstName)}
        </Link>
        {signOut}
      </div>
    );
  }

  const missed = doses.filter((d) => d.status === "missed");
  const alert = missed.length >= MISSED_ALERT_THRESHOLD;

  // When doses have been missed, the pre-filled message says so, which
  // makes this the quickest way for the patient to ask for a check-in.
  const message = alert
    ? t.family.missedMessage(firstName, missed.length, [...new Set(missed.map((d) => d.medicine_name))].join(", "), link)
    : t.family.message(firstName, link);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t.family.title}
        subtitle={patient.caregiver_name ? t.family.subtitleWith(patient.caregiver_name) : t.family.subtitle}
      />

      {alert ? (
        <section
          role="alert"
          className="mb-6 flex gap-4 rounded-2xl border-2 border-danger bg-danger-soft px-5 py-4 text-danger"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-8 shrink-0" strokeWidth={2.5} />
          <div>
            <p className="text-xl font-bold">{t.family.missedAlert(missed.length)}</p>
            <p className="mt-1 text-lg text-ink">{t.family.missedAlertBody}</p>
          </div>
        </section>
      ) : null}

      <SharePanel link={link} shareCode={patient.share_code} message={message} />

      <section aria-labelledby="settings-heading" className="mt-12 border-t-2 border-line pt-8">
        <h2 id="settings-heading" className="text-2xl font-bold">
          {t.family.settings}
        </h2>

        <h3 className="mt-6 text-xl font-semibold">{t.family.language}</h3>
        <p className="mt-1 text-lg text-ink-muted">{t.family.languageHint}</p>
        {/* One form per language, so it works before JavaScript loads. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {LANGUAGES.map((code) => {
            const current = code === patient.language;
            return (
              <form key={code} action={changeLanguage}>
                <input type="hidden" name="language" value={code} />
                <SubmitButton
                  pendingLabel={t.common.saving}
                  className={`flex min-h-touch w-full items-center justify-center gap-2 rounded-2xl border-2 px-4 py-4 text-xl font-bold ${
                    current ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink hover:border-accent"
                  }`}
                >
                  {current ? <Check aria-hidden="true" className="size-6" strokeWidth={3} /> : null}
                  <span lang={code}>{LANGUAGE_LABELS[code]}</span>
                </SubmitButton>
              </form>
            );
          })}
        </div>

        {signOut}
      </section>
    </div>
  );
}
