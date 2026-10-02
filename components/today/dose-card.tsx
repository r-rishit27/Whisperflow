import { Check, X, Clock, AlertCircle, Undo2 } from "lucide-react";
import { markDose } from "@/app/actions/doses";
import { SubmitButton } from "@/components/submit-button";
import { APP_TIME_ZONE, type Language, type TodayDose } from "@/lib/schema";
import { LOCALES, type Dictionary } from "@/lib/i18n";

/**
 * One dose on the dashboard. The buttons are plain forms posting to a
 * server action, so they work even before (or without) client JavaScript,
 * and show a spinner while saving once it has loaded.
 *
 * `highlight` is set on the next dose due: "now" when it is time to take
 * it, "next" when it is the next one coming up.
 */
export function DoseCard({
  dose,
  highlight,
  t,
  language,
}: {
  dose: TodayDose;
  highlight: "now" | "next" | null;
  t: Dictionary;
  language: Language;
}) {
  const { status } = dose;
  const actionable = status === "pending" || status === "missed";
  const time = new Intl.DateTimeFormat(LOCALES[language], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });

  const frame =
    status === "missed"
      ? "border-danger bg-danger-soft"
      : status === "taken"
        ? "border-success bg-success-soft"
        : status === "skipped"
          ? "border-line bg-surface-muted opacity-80"
          : "border-line bg-surface-muted";

  return (
    <li className={`rounded-2xl border-2 px-5 py-5 ${frame} ${highlight ? "glow border-accent" : ""}`}>
      {highlight ? (
        <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-base font-bold text-accent-ink">
          <Clock aria-hidden="true" className="size-5" />
          {highlight === "now" ? t.today.takeNow : t.today.nextDose}
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold break-words">{dose.medicine_name}</p>
          <p className="mt-1 text-lg text-ink-muted">
            {dose.dosage} · {t.food[dose.food_instruction]}
          </p>
        </div>

        {status === "missed" ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-danger px-3 py-1 text-base font-bold text-surface">
            <AlertCircle aria-hidden="true" className="size-5" />
            {t.status.missed}
          </span>
        ) : null}
      </div>

      {actionable ? (
        <div className="mt-4 flex gap-3">
          <form action={markDose} className="flex-[2]">
            <input type="hidden" name="doseId" value={dose.id} />
            <input type="hidden" name="status" value="taken" />
            <SubmitButton
              pendingLabel={t.common.saving}
              className="flex min-h-touch w-full items-center justify-center gap-2 rounded-xl bg-success px-4 py-4 text-xl font-bold text-surface hover:brightness-110"
            >
              <Check aria-hidden="true" className="size-7" strokeWidth={3} />
              {t.today.takenButton}
            </SubmitButton>
          </form>
          <form action={markDose} className="flex-1">
            <input type="hidden" name="doseId" value={dose.id} />
            <input type="hidden" name="status" value="skipped" />
            <SubmitButton
              pendingLabel={t.common.saving}
              className="flex min-h-touch w-full items-center justify-center gap-2 rounded-xl border-2 border-line bg-surface px-4 py-4 text-xl font-semibold text-ink-muted hover:bg-surface-muted"
            >
              <X aria-hidden="true" className="size-6" />
              {t.today.skipButton}
            </SubmitButton>
          </form>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p
            className={`flex items-center gap-2 text-lg font-bold ${
              status === "taken" ? "text-success" : "text-ink-muted"
            }`}
          >
            {status === "taken" ? (
              <>
                <Check aria-hidden="true" className="size-6" strokeWidth={3} />
                {dose.taken_at ? t.today.takenAt(time.format(dose.taken_at)) : t.status.taken}
              </>
            ) : (
              t.status.skipped
            )}
          </p>
          <form action={markDose}>
            <input type="hidden" name="doseId" value={dose.id} />
            <input type="hidden" name="status" value="pending" />
            <SubmitButton
              pendingLabel={t.common.saving}
              className="flex min-h-touch items-center gap-2 rounded-xl px-3 text-base font-semibold text-ink-muted underline hover:text-ink"
            >
              <Undo2 aria-hidden="true" className="size-5" />
              {t.today.undo}
            </SubmitButton>
          </form>
        </div>
      )}
    </li>
  );
}
