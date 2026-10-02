"use client";

import { AlertOctagon, AlertTriangle } from "lucide-react";
import type { PrescriptionWarning } from "@/lib/schema";
import { useT } from "@/components/i18n-provider";

/**
 * Interaction and duplicate warnings from the prescription read.
 *
 * High severity is red; moderate and low are orange. Each banner also says
 * its severity in words and uses a different icon, so the meaning never
 * depends on colour alone.
 */
export function WarningBanners({ warnings }: { warnings: PrescriptionWarning[] }) {
  const t = useT();
  if (warnings.length === 0) return null;

  // Most serious first.
  const order = { high: 0, moderate: 1, low: 2 } as const;
  const sorted = [...warnings].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <section aria-labelledby="warnings-heading" className="flex flex-col gap-3">
      <h2 id="warnings-heading" className="text-2xl font-bold">
        {t.warnings.heading}
      </h2>

      <ul className="flex flex-col gap-3">
        {sorted.map((w, i) => {
          const high = w.severity === "high";
          const Icon = high ? AlertOctagon : AlertTriangle;
          return (
            <li
              key={i}
              role={high ? "alert" : undefined}
              className={`flex gap-4 rounded-2xl border-2 px-5 py-4 ${
                high
                  ? "border-danger bg-danger-soft text-danger"
                  : "border-warning bg-warning-soft text-warning"
              }`}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-8 shrink-0" strokeWidth={2.5} />
              <div>
                <p className="text-lg font-bold">
                  {high ? t.warnings.serious : w.severity === "moderate" ? t.warnings.caution : t.warnings.note}
                  {" · "}
                  {w.kind === "duplicate" ? t.warnings.duplicate : t.warnings.interaction}
                </p>
                <p className="mt-1 text-base font-semibold">{w.medicines.join(" + ")}</p>
                <p className="mt-1 text-base text-ink">{w.explanation}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="rounded-2xl bg-surface-muted px-5 py-4 text-base text-ink-muted">
        <strong className="text-ink">{t.warnings.disclaimerStrong}</strong> {t.warnings.disclaimer}
      </p>
    </section>
  );
}
