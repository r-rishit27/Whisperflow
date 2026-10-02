import Link from "next/link";
import { redirect } from "next/navigation";
import { Camera, CheckCircle2, Sun, Sunset, Moon, Users } from "lucide-react";
import { getCurrentPatient, getCurrentSession } from "@/lib/current";
import { getTodayDoses } from "@/lib/data";
import { getDictionary, greetingKey, LOCALES } from "@/lib/i18n";
import {
  APP_TIME_ZONE,
  EARLY_WINDOW_MINUTES,
  SCHEDULE_DAYS,
  SLOTS,
  type Slot,
  type TodayDose,
} from "@/lib/schema";
import { ProgressRing } from "@/components/today/progress-ring";
import { DoseCard } from "@/components/today/dose-card";
import { CleanUrl } from "@/components/clean-url";

const SLOT_ICONS = { morning: Sun, afternoon: Sunset, night: Moon } as const;
const EARLY_WINDOW_MS = EARLY_WINDOW_MINUTES * 60 * 1000;

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const session = await getCurrentSession();

  // No patient yet -> onboarding. Already onboarded -> straight here, which
  // is what makes onboarding a one-time screen.
  if (!session) redirect("/onboarding");

  // getTodayDoses also marks anything >2h overdue as missed, in the same
  // transaction, so the statuses below are current as of this request.
  const [patient, doses] = await Promise.all([
    getCurrentPatient(),
    getTodayDoses(session.patientId, session.role),
  ]);

  // Signed cookie pointing at a deleted patient.
  if (!patient) redirect("/login");

  const t = getDictionary(patient.language);
  const locale = LOCALES[patient.language];
  const { added } = await searchParams;
  const addedCount = Number(added) || 0;

  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: APP_TIME_ZONE }).format(now),
  );
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: APP_TIME_ZONE,
  }).format(now);

  const taken = doses.filter((d) => d.status === "taken").length;
  const missed = doses.filter((d) => d.status === "missed").length;
  const remaining = doses.filter((d) => d.status === "pending").length;

  // The next dose is the earliest one still pending. Every medicine in that
  // slot gets the highlight, since they are taken together.
  const next = doses.find((d) => d.status === "pending");
  const nextIsDue = next ? next.due_at.getTime() - EARLY_WINDOW_MS <= now.getTime() : false;
  const highlightFor = (dose: TodayDose) =>
    next && dose.status === "pending" && dose.due_at.getTime() === next.due_at.getTime()
      ? nextIsDue
        ? ("now" as const)
        : ("next" as const)
      : null;

  const groups = SLOTS.map((slot) => ({ slot, doses: doses.filter((d) => d.slot === slot) })).filter(
    (g) => g.doses.length > 0,
  );

  const firstName = patient.name.split(" ")[0];

  return (
    <>
      {addedCount > 0 ? <CleanUrl params={["added"]} /> : null}

      <header className="mb-6">
        <p className="text-lg text-ink-muted">{date}</p>
        <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">
          {t.today.greeting(t.today[greetingKey(hour)], firstName)}
        </h1>
      </header>

      {addedCount > 0 ? (
        <p
          role="status"
          className="mb-6 flex items-start gap-3 rounded-2xl border-2 border-success bg-success-soft px-5 py-4 text-lg font-semibold text-success"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-7 shrink-0" />
          {t.today.added(addedCount, SCHEDULE_DAYS)}
        </p>
      ) : null}

      {session.role === "caregiver" ? (
        <p className="mb-6 flex items-center gap-3 rounded-2xl bg-surface-muted px-5 py-4 text-lg text-ink-muted">
          <Users aria-hidden="true" className="size-6 shrink-0" />
          {t.today.caregiverNote}
        </p>
      ) : null}

      {doses.length === 0 ? (
        <section className="mx-auto flex max-w-2xl flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-line px-6 py-12 text-center">
          <Camera aria-hidden="true" className="size-16 text-accent" strokeWidth={1.5} />
          <p className="text-2xl font-bold">{t.today.emptyTitle}</p>
          <p className="text-lg text-ink-muted">{t.today.emptyBody}</p>
          {session.role === "patient" ? (
            <Link
              href="/scan"
              className="flex min-h-touch items-center gap-3 rounded-2xl bg-accent px-8 py-5 text-2xl font-bold text-accent-ink"
            >
              <Camera aria-hidden="true" className="size-8" />
              {t.today.scanCta}
            </Link>
          ) : null}
        </section>
      ) : (
        // Desktop: the progress card stays in view on the left while the
        // dose list scrolls on the right.
        <div className="lg:grid lg:grid-cols-[22rem_1fr] lg:items-start lg:gap-10">
          <section
            aria-label={t.today.progressLabel}
            className="mb-8 flex flex-col items-center gap-4 rounded-3xl bg-surface-muted px-5 py-6 sm:flex-row sm:gap-8 lg:sticky lg:top-10 lg:mb-0 lg:flex-col lg:gap-5 lg:py-8"
          >
            <ProgressRing
              taken={taken}
              total={doses.length}
              label={t.today.progressAria(taken, doses.length)}
              takenWord={t.today.ringTaken}
            />
            <div className="text-center sm:text-left lg:text-center">
              <p className="text-2xl font-bold">
                {remaining === 0 && missed === 0
                  ? t.today.allDone
                  : remaining === 0
                    ? t.today.nothingLeft
                    : t.today.stillToTake(remaining)}
              </p>
              {missed > 0 ? (
                <p className="mt-1 text-lg font-semibold text-danger">{t.today.missedCount(missed)}</p>
              ) : null}
              {next ? (
                <p className="mt-1 text-lg text-ink-muted">
                  {t.today.next(t.slots[next.slot as Slot], t.slotTimes[next.slot as Slot])}
                </p>
              ) : null}
            </div>
          </section>

          <div className="flex flex-col gap-8">
            {groups.map(({ slot, doses: slotDoses }) => {
              const Icon = SLOT_ICONS[slot];
              return (
                <section key={slot} aria-labelledby={`slot-${slot}`}>
                  <h2 id={`slot-${slot}`} className="mb-3 flex flex-wrap items-center gap-x-3 text-2xl font-bold">
                    <Icon aria-hidden="true" className="size-8 text-accent" />
                    {t.slots[slot]}
                    {/* In Hindi/Telugu the time already names the slot. */}
                    <span className="text-xl font-semibold text-ink-muted">
                      {patient.language === "en" ? t.slotTimes[slot] : t.slotTimes[slot].split(" ").at(-1)}
                    </span>
                  </h2>
                  <ul className="flex max-w-3xl flex-col gap-4">
                    {slotDoses.map((dose) => (
                      <DoseCard
                        key={dose.id}
                        dose={dose}
                        highlight={highlightFor(dose)}
                        t={t}
                        language={patient.language}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
