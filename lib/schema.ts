import { z } from "zod";

/**
 * Shared types, enums and validation for MediMantra.
 *
 * Deliberately free of any database import, so client components can read
 * the labels and schemas without pulling the Postgres driver into the
 * browser bundle. Database access lives in lib/data.ts.
 */

export const LANGUAGES = ["en", "hi", "te"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  hi: "हिन्दी",
  te: "తెలుగు",
};

export const FOOD_INSTRUCTIONS = [
  "before_food",
  "after_food",
  "with_food",
  "anytime",
] as const;
export type FoodInstruction = (typeof FOOD_INSTRUCTIONS)[number];

export const FOOD_LABELS: Record<FoodInstruction, string> = {
  before_food: "Before food",
  after_food: "After food",
  with_food: "With food",
  anytime: "Any time",
};

export const DOSE_STATUSES = ["pending", "taken", "skipped", "missed"] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

// ---------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------

/**
 * Patients are in India; the server runs on UTC. Dates and "is it overdue"
 * are computed in the database by app.today() / app.dose_due_at(), and this
 * constant is only for formatting on the server.
 */
export const APP_TIME_ZONE = "Asia/Kolkata";

/** Slot keys are free text in the schema; these are the ones the app uses. */
export const SLOTS = ["morning", "afternoon", "night"] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_LABELS: Record<Slot, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  night: "Night",
};

/** Display only -- keep in step with app.slot_time() in schema.sql. */
export const SLOT_TIMES: Record<Slot, string> = {
  morning: "8:00 AM",
  afternoon: "1:00 PM",
  night: "9:00 PM",
};

/** A pending dose this long past its slot time is marked missed. */
export const MISSED_AFTER_HOURS = 2;

/** How many days of dose rows a confirmed scan creates up front. */
export const SCHEDULE_DAYS = 7;

/** Days of history on the family dashboard's adherence chart. */
export const HISTORY_DAYS = 7;

/** A dose counts as "due" (Take now, reminders, voice) this early. */
export const EARLY_WINDOW_MINUTES = 30;

/** At this many missed doses in a day, family get a red alert. */
export const MISSED_ALERT_THRESHOLD = 2;

export type Patient = {
  id: string;
  name: string;
  language: Language;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  share_code: string;
  created_at: Date;
};

export type Medicine = {
  id: string;
  patient_id: string;
  name: string;
  dosage: string;
  time_slots: string[];
  food_instruction: FoodInstruction;
  duration_days: number | null;
  created_at: Date;
};

export type DoseLog = {
  id: string;
  patient_id: string;
  medicine_id: string;
  schedule_date: string;
  slot: string;
  status: DoseStatus;
  taken_at: Date | null;
};

/** A dose joined to its medicine -- what the Today screen renders. */
export type TodayDose = DoseLog & {
  medicine_name: string;
  dosage: string;
  food_instruction: FoodInstruction;
  /** Absolute time the dose is due (slot time, Indian time). */
  due_at: Date;
};

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

export const patientInput = z.object({
  name: z.string().trim().min(1, "Please enter a name.").max(80),
  language: z.enum(LANGUAGES),
  caregiverName: z.string().trim().max(80).optional().or(z.literal("")),
  caregiverPhone: z
    .string()
    .trim()
    .regex(/^[0-9+][0-9 ()-]{6,19}$/, "Please enter a valid phone number.")
    .optional()
    .or(z.literal("")),
});
export type PatientInput = z.infer<typeof patientInput>;

export const medicineInput = z.object({
  name: z.string().trim().min(1).max(120),
  dosage: z.string().trim().min(1),
  // Deduped here rather than in a CHECK constraint, which cannot hold a
  // subquery. Order is preserved so the UI's slot order survives.
  timeSlots: z
    .array(z.string().trim().min(1))
    .min(1, "Pick at least one time.")
    .transform((slots) => [...new Set(slots)]),
  foodInstruction: z.enum(FOOD_INSTRUCTIONS).default("anytime"),
  durationDays: z.coerce.number().int().positive().nullable().default(null),
});
export type MedicineInput = z.infer<typeof medicineInput>;

// ---------------------------------------------------------------------
// Prescription scanning
// ---------------------------------------------------------------------
//
// `prescriptionResult` is handed to the model as a JSON schema (structured
// outputs), so it follows the strict-mode rules: every field required, no
// optional keys, nullable instead. Do not add .min()/.max() here -- strict
// mode rejects them; validate afterwards instead.

export const SEVERITIES = ["high", "moderate", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const parsedMedicine = z.object({
  name: z.string().describe("Medicine name as written, with strength if part of the brand, e.g. 'Dolo 650'."),
  dosage: z.string().describe("Amount per dose, e.g. '1 tablet', '500 mg', '10 ml'."),
  timings: z.object({
    morning: z.boolean(),
    afternoon: z.boolean(),
    night: z.boolean(),
  }),
  food_instruction: z.enum(FOOD_INSTRUCTIONS),
  duration_days: z
    .number()
    .int()
    .nullable()
    .describe("Course length in days. null if ongoing or not stated."),
  original_text: z
    .string()
    .describe("The instruction exactly as written, e.g. '1-0-1 x 5d AC'."),
  confidence: z
    .enum(["high", "low"])
    .describe("low if the handwriting or any field was hard to read."),
});
export type ParsedMedicine = z.infer<typeof parsedMedicine>;

export const prescriptionWarning = z.object({
  kind: z.enum(["interaction", "duplicate"]),
  severity: z.enum(SEVERITIES),
  medicines: z.array(z.string()).describe("The medicine names involved."),
  explanation: z.string().describe("One plain-English sentence a patient can understand."),
});
export type PrescriptionWarning = z.infer<typeof prescriptionWarning>;

export const prescriptionResult = z.object({
  is_prescription: z
    .boolean()
    .describe("false if the image is not a prescription or medicine label."),
  medicines: z.array(parsedMedicine),
  warnings: z.array(prescriptionWarning),
});
export type PrescriptionResult = z.infer<typeof prescriptionResult>;

/** What the scan screen sends back after the user has reviewed the cards. */
export const scannedMedicinesInput = z
  .array(
    z.object({
      name: z.string().trim().min(1, "Every medicine needs a name.").max(120),
      dosage: z.string().trim().min(1, "Every medicine needs a dosage.").max(60),
      timeSlots: z
        .array(z.enum(SLOTS))
        .min(1, "Pick at least one time for every medicine.")
        .transform((slots) => SLOTS.filter((s) => slots.includes(s))),
      foodInstruction: z.enum(FOOD_INSTRUCTIONS),
      durationDays: z.number().int().positive().max(3650).nullable(),
    }),
  )
  .min(1, "Add at least one medicine.")
  .max(30);
export type ScannedMedicinesInput = z.infer<typeof scannedMedicinesInput>;

// ---------------------------------------------------------------------
// Family dashboard
// ---------------------------------------------------------------------

export type DayAdherence = {
  /** YYYY-MM-DD, Indian date. */
  date: string;
  taken: number;
  missed: number;
  skipped: number;
  pending: number;
  /** taken / (taken + missed + skipped); null when nothing was due yet. */
  percent: number | null;
};

// ---------------------------------------------------------------------
// Voice assistant
// ---------------------------------------------------------------------

/** What the chat model returns. Strict-mode rules apply, as above. */
export const assistantTurn = z.object({
  reply: z
    .string()
    .describe("What MediMitra says back, in the patient's language. 1-3 short sentences."),
  taken_dose_ids: z
    .array(z.string())
    .describe("ids of doses the patient clearly said they have taken. Empty if none."),
});
export type AssistantTurn = z.infer<typeof assistantTurn>;

/** What /api/voice returns to the voice screen. */
export type VoiceResponse = {
  transcript: string;
  reply: string;
  /** Base64 MP3 of the reply, or null if speech synthesis failed. */
  audio: string | null;
  marked: { id: string; medicine_name: string; slot: string }[];
};

/** A dose as the reminder poller sees it (dates serialised). */
export type ReminderDose = {
  id: string;
  medicine_name: string;
  dosage: string;
  food_instruction: FoodInstruction;
  slot: string;
  status: DoseStatus;
  due_at: string;
};
