"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, ImageUp, Plus, RotateCcw, Loader2, ScanLine } from "lucide-react";
import {
  SLOTS,
  type PrescriptionResult,
  type PrescriptionWarning,
  type Slot,
} from "@/lib/schema";
import { saveScan } from "@/app/scan/actions";
import { useT } from "@/components/i18n-provider";
import type { Dictionary } from "@/lib/i18n";
import { WarningBanners } from "@/components/scan/warning-banner";
import { MedicineEditor, type DraftMedicine } from "@/components/scan/medicine-editor";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; preview: string }
  | { kind: "review"; preview: string }
  | { kind: "error"; message: string };

// Phone photos are 4000px+ and several MB. 2000px on the long edge keeps
// handwriting legible to the model while making the upload ~10x smaller.
const MAX_EDGE = 2000;

async function prepareImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    return blob ?? file;
  } catch {
    // Formats the browser cannot decode (e.g. HEIC on some browsers) go up
    // as-is; the server will say so if it cannot use them either.
    return file;
  }
}

let keyCounter = 0;
const newKey = () => `m${(keyCounter += 1)}`;

function toDraft(m: PrescriptionResult["medicines"][number]): DraftMedicine {
  return {
    key: newKey(),
    name: m.name,
    dosage: m.dosage,
    slots: SLOTS.filter((s) => m.timings[s]),
    foodInstruction: m.food_instruction,
    durationDays: m.duration_days ? String(m.duration_days) : "",
    originalText: m.original_text,
    lowConfidence: m.confidence === "low",
  };
}

const emptyDraft = (): DraftMedicine => ({
  key: newKey(),
  name: "",
  dosage: "1 tablet",
  slots: ["morning"] as Slot[],
  foodInstruction: "anytime",
  durationDays: "",
  originalText: "",
  lowConfidence: false,
});

/** Client-side check so the patient sees problems before a round trip. */
function validate(drafts: DraftMedicine[], t: Dictionary): string | null {
  const e = t.scan.errors;
  if (drafts.length === 0) return e.atLeastOne;
  for (const [i, d] of drafts.entries()) {
    const label = d.name.trim() || t.editor.medicine(i + 1);
    if (!d.name.trim()) return e.needName(i + 1);
    if (!d.dosage.trim()) return e.needDose(label);
    if (d.slots.length === 0) return e.needTime(label);
    if (d.durationDays && !(Number.isInteger(Number(d.durationDays)) && Number(d.durationDays) > 0)) {
      return e.daysWhole(label);
    }
  }
  return null;
}

type ScanErrorKey = keyof Dictionary["scan"]["errors"];
const errorText = (t: Dictionary, code: unknown, fallback: string): string => {
  const value = t.scan.errors[code as ScanErrorKey];
  return typeof value === "string" ? value : fallback;
};

export function ScanFlow() {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [drafts, setDrafts] = useState<DraftMedicine[]>([]);
  const [warnings, setWarnings] = useState<PrescriptionWarning[]>([]);
  const [notPrescription, setNotPrescription] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  // Release the preview's object URL when it is replaced or we unmount.
  const preview = phase.kind === "reading" || phase.kind === "review" ? phase.preview : null;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  // Move focus to the results so screen readers announce them.
  useEffect(() => {
    if (phase.kind === "review") reviewHeading.current?.focus();
  }, [phase.kind]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setPhase({ kind: "reading", preview: previewUrl });
    setSaveError(null);

    try {
      const body = new FormData();
      const image = await prepareImage(file);
      body.append("image", image, "prescription.jpg");

      const res = await fetch("/api/parse", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(errorText(t, json.code, t.scan.errors.failed));

      const result = json as PrescriptionResult;
      setNotPrescription(!result.is_prescription || result.medicines.length === 0);
      setDrafts(result.medicines.map(toDraft));
      setWarnings(result.warnings);
      setPhase({ kind: "review", preview: previewUrl });
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : t.scan.errors.failed,
      });
    }
  }

  function reset() {
    setPhase({ kind: "idle" });
    setDrafts([]);
    setWarnings([]);
    setSaveError(null);
    setNotPrescription(false);
  }

  function save() {
    const problem = validate(drafts, t);
    if (problem) {
      setSaveError(problem);
      return;
    }
    setSaveError(null);

    startSaving(async () => {
      const result = await saveScan(
        drafts.map((d) => ({
          name: d.name.trim(),
          dosage: d.dosage.trim(),
          timeSlots: d.slots,
          foodInstruction: d.foodInstruction,
          durationDays: d.durationDays ? Number(d.durationDays) : null,
        })),
      );
      // On success the action redirects, so we only get here on failure.
      if (result?.error) setSaveError(errorText(t, result.error, t.scan.errors.saveFailed));
    });
  }

  // Hidden pickers: one opens the rear camera directly, one the gallery.
  const pickers = (
    <>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={uploadInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );

  // ------------------------------------------------------------------
  if (phase.kind === "idle" || phase.kind === "error") {
    return (
      <div className="flex flex-col gap-5">
        {pickers}

        <button
          type="button"
          onClick={() => cameraInput.current?.click()}
          className="flex flex-col items-center justify-center gap-4 rounded-3xl border-4 border-dashed border-accent bg-teal-50 px-6 py-12 text-accent hover:bg-teal-100"
        >
          <Camera aria-hidden="true" className="size-28" strokeWidth={1.5} />
          <span className="text-2xl font-bold">{t.scan.takePhoto}</span>
          <span className="text-base text-ink-muted">{t.scan.takePhotoHint}</span>
        </button>

        <button
          type="button"
          onClick={() => uploadInput.current?.click()}
          className="flex min-h-touch items-center justify-center gap-3 rounded-2xl border-2 border-accent px-6 py-5 text-xl font-bold text-accent hover:bg-teal-50"
        >
          <ImageUp aria-hidden="true" className="size-7" />
          {t.scan.upload}
        </button>

        {phase.kind === "error" ? (
          <p
            role="alert"
            className="rounded-2xl border-2 border-danger bg-danger-soft px-5 py-4 text-lg font-semibold text-danger"
          >
            {phase.message}
          </p>
        ) : null}

        <p className="text-base text-ink-muted">
          {t.scan.tip}
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  if (phase.kind === "reading") {
    return (
      <div className="flex flex-col items-center gap-6">
        <div className="relative w-full overflow-hidden rounded-3xl border-4 border-accent bg-surface-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img
            src={phase.preview}
            alt={t.scan.photoAlt}
            className="block max-h-[55vh] w-full object-contain opacity-80"
          />
          <div className="scan-beam" aria-hidden="true" />
        </div>

        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 text-center">
          <p className="flex items-center gap-3 text-2xl font-bold text-accent">
            <ScanLine aria-hidden="true" className="size-8" />
            {t.scan.reading}
          </p>
          <p className="text-lg text-ink-muted">{t.scan.readingHint}</p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      {pickers}

      <div>
        <h2
          ref={reviewHeading}
          tabIndex={-1}
          className="text-2xl font-bold outline-none"
        >
          {notPrescription ? t.scan.noneFound : t.scan.found(drafts.length)}
        </h2>
        <p className="mt-1 text-lg text-ink-muted">
          {notPrescription ? t.scan.noneFoundHint : t.scan.checkHint}
        </p>
      </div>

      <WarningBanners warnings={warnings} />

      {drafts.map((draft, i) => (
        <MedicineEditor
          key={draft.key}
          index={i}
          draft={draft}
          onChange={(next) =>
            setDrafts((all) => all.map((d) => (d.key === next.key ? next : d)))
          }
          onRemove={() => setDrafts((all) => all.filter((d) => d.key !== draft.key))}
        />
      ))}

      <button
        type="button"
        onClick={() => setDrafts((all) => [...all, emptyDraft()])}
        className="flex min-h-touch items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line px-6 py-4 text-lg font-bold text-ink-muted hover:border-accent hover:text-accent"
      >
        <Plus aria-hidden="true" className="size-6" />
        {t.scan.addMedicine}
      </button>

      {saveError ? (
        <p
          role="alert"
          className="rounded-2xl border-2 border-danger bg-danger-soft px-5 py-4 text-lg font-semibold text-danger"
        >
          {saveError}
        </p>
      ) : null}

      <div className="sticky bottom-[calc(var(--spacing-nav)+0.75rem)] flex flex-col gap-3 bg-surface pt-2 lg:bottom-6">
        <button
          type="button"
          onClick={save}
          disabled={saving || drafts.length === 0}
          className="flex min-h-touch items-center justify-center gap-3 rounded-2xl bg-accent px-6 py-5 text-2xl font-bold text-accent-ink disabled:opacity-60"
        >
          {saving ? (
            <>
              <Loader2 aria-hidden="true" className="size-7 animate-spin" />
              {t.common.saving}
            </>
          ) : (
            t.scan.confirm(drafts.length)
          )}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="flex min-h-touch items-center justify-center gap-2 rounded-2xl px-6 py-3 text-lg font-semibold text-ink-muted"
        >
          <RotateCcw aria-hidden="true" className="size-5" />
          {t.scan.scanAgain}
        </button>
      </div>
    </div>
  );
}
