import "server-only";

import { randomInt } from "node:crypto";
import { sql, withPatient, type AppRole, type TransactionSql } from "@/lib/db";
import {
  patientInput,
  medicineInput,
  scannedMedicinesInput,
  MISSED_AFTER_HOURS,
  SCHEDULE_DAYS,
  HISTORY_DAYS,
  EARLY_WINDOW_MINUTES,
  type DayAdherence,
  type ScannedMedicinesInput,
  type Language,
  type Patient,
  type PatientInput,
  type Medicine,
  type MedicineInput,
  type DoseLog,
  type DoseStatus,
  type TodayDose,
} from "@/lib/schema";

/**
 * Database access for MediMantra.
 *
 * Every function that touches patient data goes through `withPatient`, so
 * the RLS policies in schema.sql decide what is visible. A missing or wrong
 * identity returns no rows rather than someone else's.
 */

// Re-exported so server callers can import types and queries from one place.
export * from "@/lib/schema";

// ---------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------

// 0/O and 1/I are omitted: share codes get read aloud over the phone.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function generateShareCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Creates a patient and returns the full row, including the share code the
 * family will use. Runs before any identity exists, so it goes through the
 * security-definer `app.create_patient`.
 */
export async function createPatient(input: PatientInput): Promise<Patient> {
  const data = patientInput.parse(input);

  // Retry on the 1-in-a-billion share-code collision rather than failing
  // onboarding over it.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const rows = await sql<Patient[]>`
        select * from app.create_patient(
          ${data.name},
          ${data.language}::patient_language,
          ${data.caregiverName || null},
          ${data.caregiverPhone || null},
          ${generateShareCode()}
        )
      `;
      return rows[0];
    } catch (error) {
      const isDuplicate =
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23505";
      if (!isDuplicate || attempt === 4) throw error;
    }
  }

  throw new Error("Could not allocate a share code.");
}

export async function getPatientById(
  patientId: string,
  role: AppRole = "patient",
): Promise<Patient | null> {
  return withPatient(patientId, role, async (tx) => {
    const rows = await tx<Patient[]>`
      select id, name, language, caregiver_name, caregiver_phone, share_code, created_at
        from patients
       where id = ${patientId}
    `;
    return rows.at(0) ?? null;
  });
}

/**
 * Resolves a share code to a patient. Used by the Family tab, so the result
 * is read with caregiver privileges.
 */
/** Allowed for the patient role only, by the patients_update policy. */
export async function setPatientLanguage(patientId: string, language: Language): Promise<void> {
  await withPatient(patientId, "patient", async (tx) => {
    await tx`update patients set language = ${language}::patient_language where id = ${patientId}`;
  });
}

export async function getPatientByShareCode(
  code: string,
): Promise<Patient | null> {
  const rows = await sql<{ resolve_share_code: string | null }[]>`
    select app.resolve_share_code(${code.toUpperCase()}) as resolve_share_code
  `;
  const patientId = rows.at(0)?.resolve_share_code;
  if (!patientId) return null;

  return getPatientById(patientId, "caregiver");
}

// ---------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------

/** Inserts one or more medicines in a single transaction. */
export async function addMedicines(
  patientId: string,
  medicines: MedicineInput[],
): Promise<Medicine[]> {
  const parsed = medicines.map((m) => medicineInput.parse(m));
  if (parsed.length === 0) return [];

  return withPatient(patientId, "patient", async (tx) => {
    const rows = parsed.map((m) => ({
      patient_id: patientId,
      name: m.name,
      dosage: m.dosage,
      time_slots: m.timeSlots,
      food_instruction: m.foodInstruction,
      duration_days: m.durationDays,
    }));

    return tx<Medicine[]>`
      insert into medicines ${tx(
        rows,
        "patient_id",
        "name",
        "dosage",
        "time_slots",
        "food_instruction",
        "duration_days",
      )}
      returning *
    `;
  });
}

export async function getMedicines(patientId: string, role: AppRole = "patient") {
  return withPatient(patientId, role, async (tx) => {
    return tx<Medicine[]>`
      select * from medicines where patient_id = ${patientId} order by created_at
    `;
  });
}

// ---------------------------------------------------------------------
// Doses
// ---------------------------------------------------------------------
//
// All dates and due times come from app.today() and app.dose_due_at() in
// schema.sql, which work in Indian time. Nothing here uses the server's
// clock or current_date, which are UTC and wrong for 5.5 hours a day.

/**
 * Fills in dose rows for `days` days starting `from` days after today
 * (negative = the past), for every medicine the patient has. Idempotent:
 * the unique constraint on (medicine_id, schedule_date, slot) makes
 * re-running it a no-op.
 *
 * Backfilling the past matters for history: an ongoing medicine only has
 * rows for days someone opened the app, so without it, days the patient
 * never looked would silently vanish from adherence instead of showing as
 * missed. Backfilled rows are pending; markOverdue turns them missed.
 *
 * A slot is only generated if it falls inside the medicine's course, and
 * not if it was already overdue when the medicine was added -- otherwise a
 * prescription saved at 3 PM would show that morning's dose as missed.
 */
async function generateDoses(
  tx: TransactionSql,
  patientId: string,
  { from, days }: { from: number; days: number },
): Promise<number> {
  const rows = await tx`
    insert into dose_logs (patient_id, medicine_id, schedule_date, slot)
    select m.patient_id, m.id, day::date, slot
      from medicines m
      cross join unnest(m.time_slots) as slot
      cross join generate_series(
        app.today() + ${from}::int,
        app.today() + ${from + days - 1}::int,
        interval '1 day'
      ) as day
     where m.patient_id = ${patientId}
       and day::date >= (m.created_at at time zone 'Asia/Kolkata')::date
       and (
         m.duration_days is null
         or day::date < (m.created_at at time zone 'Asia/Kolkata')::date + m.duration_days
       )
       and app.dose_due_at(day::date, slot)
             >= m.created_at - make_interval(hours => ${MISSED_AFTER_HOURS}::int)
    on conflict (medicine_id, schedule_date, slot) do nothing
    returning id
  `;
  return rows.length;
}

/**
 * Marks every pending dose more than MISSED_AFTER_HOURS past its slot time
 * as missed. Covers earlier days too, so a patient who skips opening the app
 * for a while still gets an accurate history.
 */
async function markOverdue(tx: TransactionSql, patientId: string): Promise<number> {
  const rows = await tx`
    update dose_logs
       set status = 'missed'
     where patient_id = ${patientId}
       and status = 'pending'
       and app.dose_due_at(schedule_date, slot)
             < now() - make_interval(hours => ${MISSED_AFTER_HOURS}::int)
    returning id
  `;
  return rows.length;
}

/** Standalone version of markOverdue, e.g. for a scheduled job. */
export async function markOverdueAsMissed(patientId: string): Promise<number> {
  return withPatient(patientId, "patient", (tx) => markOverdue(tx, patientId));
}

/**
 * Today's doses with their medicine details, ordered by due time.
 *
 * In one transaction this also (1) creates today's rows for ongoing
 * medicines that have run past the initial 7-day window, and (2) marks
 * anything more than two hours overdue as missed -- so what the patient
 * sees is always current, without needing a background job.
 */
export async function getTodayDoses(
  patientId: string,
  role: AppRole = "patient",
): Promise<TodayDose[]> {
  return withPatient(patientId, role, async (tx) => {
    await generateDoses(tx, patientId, { from: -(HISTORY_DAYS - 1), days: HISTORY_DAYS });
    await markOverdue(tx, patientId);

    return tx<TodayDose[]>`
      select d.*,
             m.name as medicine_name,
             m.dosage,
             m.food_instruction,
             app.dose_due_at(d.schedule_date, d.slot) as due_at
        from dose_logs d
        join medicines m on m.id = d.medicine_id
       where d.patient_id = ${patientId}
         and d.schedule_date = app.today()
       order by due_at, m.name
    `;
  });
}

/**
 * Saves medicines confirmed on the scan screen and creates their dose rows
 * for the next SCHEDULE_DAYS days, atomically: either everything is saved
 * or nothing is.
 */
export async function saveScannedMedicines(
  patientId: string,
  medicines: ScannedMedicinesInput,
): Promise<{ medicines: number; doses: number }> {
  const parsed = scannedMedicinesInput.parse(medicines);

  return withPatient(patientId, "patient", async (tx) => {
    const rows = parsed.map((m) => ({
      patient_id: patientId,
      name: m.name,
      dosage: m.dosage,
      time_slots: m.timeSlots,
      food_instruction: m.foodInstruction,
      duration_days: m.durationDays,
    }));

    const inserted = await tx`
      insert into medicines ${tx(
        rows,
        "patient_id",
        "name",
        "dosage",
        "time_slots",
        "food_instruction",
        "duration_days",
      )}
      returning id
    `;

    const doses = await generateDoses(tx, patientId, { from: 0, days: SCHEDULE_DAYS });
    return { medicines: inserted.length, doses };
  });
}

/**
 * Sets a dose's status. `taken_at` is kept in step with the status to
 * satisfy the table's check constraint: a timestamp when taken, NULL
 * otherwise.
 */
export async function updateDoseStatus(
  patientId: string,
  doseId: string,
  status: DoseStatus,
  role: AppRole = "patient",
): Promise<DoseLog | null> {
  return withPatient(patientId, role, async (tx) => {
    const rows = await tx<DoseLog[]>`
      update dose_logs
         set status = ${status}::dose_status,
             taken_at = case when ${status}::dose_status = 'taken'
                             then coalesce(taken_at, now())
                             else null end
       where id = ${doseId}
       returning *
    `;
    return rows.at(0) ?? null;
  });
}

/**
 * Marks doses taken on the patient's say-so (the voice assistant).
 *
 * Only doses that are today's, still pending or missed, and already due
 * (or within EARLY_WINDOW_MINUTES of being due) can be marked -- so "I took
 * my tablets" at 9 AM cannot tick off tonight's dose. The model proposes
 * ids; this is the gate that decides, and RLS scopes it to the patient.
 */
export async function markDosesTaken(
  patientId: string,
  doseIds: string[],
  role: AppRole = "patient",
): Promise<{ id: string; medicine_name: string; slot: string }[]> {
  if (doseIds.length === 0) return [];

  return withPatient(patientId, role, async (tx) => {
    return tx<{ id: string; medicine_name: string; slot: string }[]>`
      update dose_logs d
         set status = 'taken',
             taken_at = now()
        from medicines m
       where m.id = d.medicine_id
         and d.id = any(${doseIds}::uuid[])
         and d.patient_id = ${patientId}
         and d.schedule_date = app.today()
         and d.status in ('pending', 'missed')
         and app.dose_due_at(d.schedule_date, d.slot)
               <= now() + make_interval(mins => ${EARLY_WINDOW_MINUTES}::int)
      returning d.id, m.name as medicine_name, d.slot
    `;
  });
}

/**
 * Per-day dose counts for the last HISTORY_DAYS days, oldest first, with
 * every day present even if it had no doses. Backfills and marks overdue
 * first, so the numbers are current.
 */
export async function getAdherence(
  patientId: string,
  role: AppRole = "caregiver",
): Promise<DayAdherence[]> {
  return withPatient(patientId, role, async (tx) => {
    await generateDoses(tx, patientId, { from: -(HISTORY_DAYS - 1), days: HISTORY_DAYS });
    await markOverdue(tx, patientId);

    const rows = await tx<
      { date: string; taken: number; missed: number; skipped: number; pending: number }[]
    >`
      select to_char(day, 'YYYY-MM-DD') as date,
             count(d.id) filter (where d.status = 'taken')::int   as taken,
             count(d.id) filter (where d.status = 'missed')::int  as missed,
             count(d.id) filter (where d.status = 'skipped')::int as skipped,
             count(d.id) filter (where d.status = 'pending')::int as pending
        from generate_series(
               app.today() - ${HISTORY_DAYS - 1}::int,
               app.today(),
               interval '1 day'
             ) as day
        left join dose_logs d
               on d.schedule_date = day::date
              and d.patient_id = ${patientId}
       group by day
       order by day
    `;

    return rows.map((r) => {
      // Adherence counts only doses that are already due: an 8 PM dose
      // that has not happened yet is not a failure at noon.
      const due = r.taken + r.missed + r.skipped;
      return { ...r, percent: due === 0 ? null : Math.round((r.taken / due) * 100) };
    });
  });
}
