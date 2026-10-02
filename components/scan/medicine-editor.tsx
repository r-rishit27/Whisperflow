"use client";

import { Trash2, Eye } from "lucide-react";
import { FOOD_INSTRUCTIONS, SLOTS, type FoodInstruction, type Slot } from "@/lib/schema";
import { useT } from "@/components/i18n-provider";

/** One medicine as the patient is editing it on the scan screen. */
export type DraftMedicine = {
  key: string;
  name: string;
  dosage: string;
  slots: Slot[];
  foodInstruction: FoodInstruction;
  /** Kept as text so the field can be cleared; "" means ongoing. */
  durationDays: string;
  originalText: string;
  lowConfidence: boolean;
};

const fieldClass =
  "w-full rounded-xl border-2 border-line bg-surface px-4 py-3 text-xl";

export function MedicineEditor({
  index,
  draft,
  onChange,
  onRemove,
}: {
  index: number;
  draft: DraftMedicine;
  onChange: (next: DraftMedicine) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const id = (field: string) => `med-${draft.key}-${field}`;
  const update = (patch: Partial<DraftMedicine>) => onChange({ ...draft, ...patch });

  const toggleSlot = (slot: Slot) =>
    update({
      slots: draft.slots.includes(slot)
        ? draft.slots.filter((s) => s !== slot)
        : [...draft.slots, slot],
    });

  const noSlot = draft.slots.length === 0;

  return (
    <article
      aria-labelledby={id("title")}
      className={`rounded-2xl border-2 bg-surface-muted px-5 py-5 ${
        draft.lowConfidence ? "border-warning" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={id("title")} className="text-xl font-bold">
          {t.editor.medicine(index + 1)}
        </h3>
        <button
          type="button"
          onClick={onRemove}
          className="flex min-h-touch items-center gap-2 rounded-xl px-3 text-base font-semibold text-danger hover:bg-danger-soft"
        >
          <Trash2 aria-hidden="true" className="size-6" />
          {t.editor.remove}
        </button>
      </div>

      {draft.lowConfidence ? (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-warning-soft px-4 py-3 text-base font-semibold text-warning">
          <Eye aria-hidden="true" className="size-6 shrink-0" />
          {t.editor.hardToRead}
        </p>
      ) : null}

      {draft.originalText ? (
        <p className="mt-3 text-base text-ink-muted">
          {t.editor.writtenAs} <span className="font-mono text-ink">{draft.originalText}</span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor={id("name")} className="mb-1 block text-lg font-semibold">
            {t.editor.name}
          </label>
          <input
            id={id("name")}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            maxLength={120}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor={id("dosage")} className="mb-1 block text-lg font-semibold">
            {t.editor.dose}
          </label>
          <input
            id={id("dosage")}
            value={draft.dosage}
            onChange={(e) => update({ dosage: e.target.value })}
            maxLength={60}
            placeholder={t.editor.dosePlaceholder}
            className={fieldClass}
          />
        </div>

        <fieldset>
          <legend className="mb-2 text-lg font-semibold">{t.editor.when}</legend>
          <div className="grid grid-cols-3 gap-2">
            {SLOTS.map((slot) => {
              const on = draft.slots.includes(slot);
              return (
                <button
                  key={slot}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSlot(slot)}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 px-2 py-3 ${
                    on
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line bg-surface text-ink"
                  }`}
                >
                  <span className="text-lg font-bold">{t.slots[slot]}</span>
                  <span className="text-sm">{t.slotTimes[slot]}</span>
                </button>
              );
            })}
          </div>
          {noSlot ? (
            <p className="mt-2 text-base font-semibold text-danger">
              {t.editor.pickTime}
            </p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-lg font-semibold">{t.editor.food}</legend>
          <div className="grid grid-cols-2 gap-2">
            {FOOD_INSTRUCTIONS.map((food) => {
              const on = draft.foodInstruction === food;
              return (
                <button
                  key={food}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ foodInstruction: food })}
                  className={`rounded-xl border-2 px-3 py-3 text-lg font-semibold ${
                    on
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line bg-surface text-ink"
                  }`}
                >
                  {t.food[food]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label htmlFor={id("days")} className="mb-1 block text-lg font-semibold">
            {t.editor.days}
          </label>
          <input
            id={id("days")}
            type="number"
            inputMode="numeric"
            min={1}
            max={3650}
            value={draft.durationDays}
            onChange={(e) => update({ durationDays: e.target.value })}
            placeholder={t.editor.daysPlaceholder}
            className={fieldClass}
          />
        </div>
      </div>
    </article>
  );
}
