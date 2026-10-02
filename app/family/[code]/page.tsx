import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { AlertTriangle, AlertCircle, Check, Clock, Minus } from "lucide-react";
import { getAdherence, getPatientByShareCode, getTodayDoses } from "@/lib/data";
import { getDictionary } from "@/lib/i18n";
import { MISSED_ALERT_THRESHOLD, type DoseStatus, type Slot } from "@/lib/schema";
import { AdherenceChart } from "@/components/family/adherence-chart";
import { LanguageProvider } from "@/components/i18n-provider";

/**
 * Public, read-only family dashboard, reached by share code. No sign-in:
 * the code is the credential. Data is read with the caregiver role, so the
 * RLS policies still apply and nothing here can change the schedule.
 *
 * Shown in the patient's language -- the family usually shares it -- and
 * wrapped in its own LanguageProvider, since a visitor has no session.
 */

const SHARE_CODE = /^[2-9A-HJ-NP-Z]{6}$/;

// Shared by generateMetadata and the page: one lookup per request.
const findPatient = cache(async (raw: string) => {
  const code = raw.toUpperCase();
  return SHARE_CODE.test(code) ? getPatientByShareCode(code) : null;
});

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const patient = await findPatient((await params).code);
  const t = getDictionary(patient?.language);
  return {
    // The browser tab is part of the page too: translate it.
    title: patient ? `${t.dashboard.title(patient.name.split(" ")[0])} · MediMantra` : "MediMantra",
    // Health data: keep it out of search engines and link previews' caches.
    robots: { index: false, follow: false, nocache: true },
  };
}

const STATUS_STYLE: Record<DoseStatus, { Icon: typeof Check; className: string }> = {
  taken: { Icon: Check, className: "bg-success-soft text-success" },
  missed: { Icon: AlertCircle, className: "bg-danger text-surface" },
  skipped: { Icon: Minus, className: "bg-surface-muted text-ink-muted" },
  pending: { Icon: Clock, className: "bg-teal-50 text-accent" },
};

export default async function FamilyDashboard({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const patient = await findPatient((await params).code);
  if (!patient) notFound();

  const [today, days] = await Promise.all([
    getTodayDoses(patient.id, "caregiver"),
    getAdherence(patient.id, "caregiver"),
  ]);

  const t = getDictionary(patient.language);
  const firstName = patient.name.split(" ")[0];
  const todayStats = days.at(-1);
  const missedToday = today.filter((d) => d.status === "missed");
  const alert = missedToday.length >= MISSED_ALERT_THRESHOLD;

  return (
    <LanguageProvider language={patient.language}>
      <div lang={patient.language}>
        <header className="mb-6">
          <p className="text-lg text-ink-muted">{t.dashboard.eyebrow}</p>
          <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">{t.dashboard.title(firstName)}</h1>
        </header>

        {alert ? (
          <section
            role="alert"
            className="mb-6 flex gap-4 rounded-2xl border-2 border-danger bg-danger-soft px-5 py-5 text-danger"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-9 shrink-0" strokeWidth={2.5} />
            <div>
              <p className="text-2xl font-bold">{t.family.missedAlert(missedToday.length)}</p>
              <p className="mt-1 text-lg text-ink">
                {t.dashboard.alertBody([...new Set(missedToday.map((d) => d.medicine_name))].join(", "), firstName)}
              </p>
            </div>
          </section>
        ) : null}

        <div className="lg:grid lg:grid-cols-[1fr_24rem] lg:items-start lg:gap-10">
          <div>
            {/* Hero figure: today's adherence. */}
            <section aria-labelledby="today-heading" className="mb-8 rounded-3xl bg-surface-muted px-6 py-6">
              <h2 id="today-heading" className="text-lg font-semibold text-ink-muted">
                {t.dashboard.takenToday}
              </h2>
              {todayStats?.percent === null || todayStats === undefined ? (
                <p className="mt-1 text-3xl font-bold">{t.dashboard.noneDue}</p>
              ) : (
                <>
                  <p
                    className={`mt-1 text-6xl font-bold ${todayStats.missed > 0 ? "text-danger" : "text-ink"}`}
                  >
                    {todayStats.percent}%
                  </p>
                  <p className="mt-1 text-lg text-ink-muted">
                    {t.dashboard.dueSoFar(
                      todayStats.taken,
                      todayStats.taken + todayStats.missed + todayStats.skipped,
                      todayStats.pending,
                    )}
                  </p>
                </>
              )}
            </section>

            <section aria-labelledby="week-heading" className="mb-8">
              <h2 id="week-heading" className="mb-4 text-2xl font-bold">
                {t.dashboard.last7}
              </h2>
              <AdherenceChart days={days} />
            </section>
          </div>

          <section aria-labelledby="doses-heading">
            <h2 id="doses-heading" className="mb-4 text-2xl font-bold">
              {t.dashboard.todaysDoses}
            </h2>
            {today.length === 0 ? (
              <p className="rounded-2xl border-2 border-dashed border-line px-5 py-8 text-center text-lg text-ink-muted">
                {t.dashboard.noneToday}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {today.map((d) => {
                  const s = STATUS_STYLE[d.status];
                  return (
                    <li
                      key={d.id}
                      className={`flex items-center justify-between gap-3 rounded-2xl border-2 px-5 py-4 ${
                        d.status === "missed" ? "border-danger bg-danger-soft" : "border-line"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xl font-bold break-words">{d.medicine_name}</p>
                        <p className="text-base text-ink-muted">
                          {patient.language === "en"
                            ? `${t.slots[d.slot as Slot]} · ${t.slotTimes[d.slot as Slot]}`
                            : t.slotTimes[d.slot as Slot]}{" "}
                          · {d.dosage}
                        </p>
                      </div>
                      <span
                        className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-base font-bold ${s.className}`}
                      >
                        <s.Icon aria-hidden="true" className="size-5" />
                        {t.status[d.status]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <p className="mt-10 text-base text-ink-muted">{t.dashboard.footer(firstName)}</p>
      </div>
    </LanguageProvider>
  );
}
