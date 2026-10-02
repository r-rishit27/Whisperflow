/**
 * Applies schema.sql, then exercises the data layer end to end and proves
 * the RLS policies actually bite.
 *
 *   node --env-file=.env scripts/verify-db.mjs
 *
 * Safe to re-run: the schema is idempotent, and the test rows this creates
 * are deleted at the end (pass --keep to leave them in place).
 *
 * The RLS section is skipped unless DATABASE_URL connects as a role without
 * BYPASSRLS -- as `postgres`, the policies are inert and the check would be
 * meaningless rather than passing.
 */

import { readFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with: node --env-file=.env scripts/verify-db.mjs");
  process.exit(1);
}

const keep = process.argv.includes("--keep");

const connect = (connectionString) =>
  postgres(connectionString, {
    prepare: !connectionString.includes(":6543"),
    ssl: "require",
    max: 1,
    connect_timeout: 15,
    onnotice: () => {},
  });

// The app connection, which is what the assertions run against.
const sql = connect(url);

// Schema changes and cleanup need the owner. When ADMIN_DATABASE_URL is
// unset, both roles are the same connection -- which is exactly the case
// where the RLS section below gets skipped.
const admin = connect(process.env.ADMIN_DATABASE_URL ?? url);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

/** Mirrors lib/db.ts withPatient: transaction-local identity for RLS. */
const withPatient = (patientId, role, fn) =>
  sql.begin(async (tx) => {
    await tx`select set_config('app.current_patient', ${patientId}, true)`;
    await tx`select set_config('app.current_role', ${role}, true)`;
    return fn(tx);
  });

const code = () => {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
};

const created = [];

try {
  // -----------------------------------------------------------------
  console.log("\n1. Connection");
  const [info] = await sql`
    select current_user, current_setting('server_version') as version,
           (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls
  `;
  check("connected", true, `${info.current_user} @ Postgres ${info.version}`);
  const rlsEnforced = info.bypassrls === false;
  if (!rlsEnforced) {
    console.log(`  NOTE  role '${info.current_user}' has BYPASSRLS — policies are inert for it.`);
  }

  // -----------------------------------------------------------------
  console.log("\n2. Applying schema.sql");
  // Simple protocol, so the whole file runs as one multi-statement batch.
  await admin.unsafe(readFileSync("schema.sql", "utf8"), [], { simple: true });
  check("schema applied", true);

  const tables = await sql`
    select tablename, rowsecurity from pg_tables
     where schemaname = 'public' and tablename in ('patients','medicines','dose_logs')
     order by tablename
  `;
  check("three tables exist", tables.length === 3, tables.map((t) => t.tablename).join(", "));
  check("RLS enabled on all three", tables.every((t) => t.rowsecurity));

  const policies = await sql`
    select count(*)::int as n from pg_policies where schemaname = 'public'
  `;
  check("policies present", policies[0].n >= 6, `${policies[0].n} policies`);

  // -----------------------------------------------------------------
  console.log("\n3. createPatient");
  const [alice] = await sql`
    select * from app.create_patient('Test Alice', 'hi', 'Test Carer', '+91 90000 00001', ${code()})
  `;
  created.push(alice.id);
  check("patient created", Boolean(alice.id), `id ${alice.id.slice(0, 8)}…`);
  check("language stored", alice.language === "hi", alice.language);
  check("share code is 6 chars", alice.share_code.length === 6, alice.share_code);
  check("created_at set", alice.created_at instanceof Date);

  const [bob] = await sql`
    select * from app.create_patient('Test Bob', 'te', null, null, ${code()})
  `;
  created.push(bob.id);
  check("second patient created", Boolean(bob.id));

  // -----------------------------------------------------------------
  console.log("\n4. getPatientById / getPatientByShareCode");
  const byId = await withPatient(alice.id, "patient", (tx) =>
    tx`select name from patients where id = ${alice.id}`,
  );
  check("by id", byId[0]?.name === "Test Alice", byId[0]?.name);

  const [resolved] = await sql`
    select app.resolve_share_code(${alice.share_code}) as id
  `;
  check("by share code", resolved.id === alice.id);

  const [lowered] = await sql`
    select app.resolve_share_code(${alice.share_code.toLowerCase()}) as id
  `;
  check("share code is case-insensitive", lowered.id === alice.id);

  // -----------------------------------------------------------------
  console.log("\n5. Registration (app.set_password)");
  const hash = `scrypt:aa:${scryptSync("correct horse battery", Buffer.from("aa", "hex"), 64).toString("hex")}`;
  const [first] = await sql`select app.set_password(${alice.id}, ${hash}) as ok`;
  check("password set on first registration", first.ok === true);
  const [second] = await sql`select app.set_password(${alice.id}, ${hash}) as ok`;
  check("second registration cannot overwrite", second.ok === null);

  const [lookup] = await sql`select * from app.auth_lookup(${alice.id})`;
  check("auth_lookup returns the hash", lookup.password_hash === hash);
  check("auth_lookup leaks nothing else", Object.keys(lookup).join(",") === "id,password_hash");

  // -----------------------------------------------------------------
  console.log("\n6. addMedicines");
  const meds = await withPatient(alice.id, "patient", (tx) =>
    tx`
      insert into medicines ${tx(
        [
          {
            patient_id: alice.id,
            name: "Metformin",
            dosage: "500 mg",
            time_slots: ["morning", "night"],
            food_instruction: "after_food",
            duration_days: 30,
          },
          {
            patient_id: alice.id,
            name: "Amlodipine",
            dosage: "5 mg",
            time_slots: ["morning"],
            food_instruction: "anytime",
            duration_days: null,
          },
        ],
        "patient_id", "name", "dosage", "time_slots", "food_instruction", "duration_days",
      )}
      returning *
    `,
  );
  check("two medicines inserted", meds.length === 2);
  check("time_slots round-trips as an array", Array.isArray(meds[0].time_slots) && meds[0].time_slots.length === 2, JSON.stringify(meds[0].time_slots));

  let rejected = false;
  try {
    await withPatient(alice.id, "patient", (tx) =>
      tx`insert into medicines (patient_id, name, dosage, time_slots)
         values (${alice.id}, 'Bad', '1', '{}')`,
    );
  } catch {
    rejected = true;
  }
  check("empty time_slots rejected", rejected);

  // -----------------------------------------------------------------
  console.log("\n7. getTodayDoses");
  const generate = (patientId, role) =>
    withPatient(patientId, role, async (tx) => {
      await tx`
        insert into dose_logs (patient_id, medicine_id, schedule_date, slot)
        select m.patient_id, m.id, current_date, slot
          from medicines m cross join unnest(m.time_slots) as slot
         where m.patient_id = ${patientId}
           and (m.duration_days is null
                or current_date < (m.created_at::date + m.duration_days))
           and current_date >= m.created_at::date
        on conflict (medicine_id, schedule_date, slot) do nothing
      `;
      return tx`
        select d.*, m.name as medicine_name, m.dosage, m.food_instruction
          from dose_logs d join medicines m on m.id = d.medicine_id
         where d.patient_id = ${patientId} and d.schedule_date = current_date
         order by array_position(array['morning','afternoon','evening','night'], d.slot) nulls last, m.name
      `;
    });

  const doses = await generate(alice.id, "patient");
  check("3 doses generated (2 slots + 1 slot)", doses.length === 3, `${doses.length} doses`);
  check("all start pending", doses.every((d) => d.status === "pending"));
  check("joined to medicine name", Boolean(doses[0].medicine_name), doses[0].medicine_name);
  check("ordered morning first", doses[0].slot === "morning", doses.map((d) => d.slot).join(" → "));

  const again = await generate(alice.id, "patient");
  check("second read is idempotent", again.length === 3, `${again.length} doses`);

  // -----------------------------------------------------------------
  console.log("\n8. updateDoseStatus");
  const target = doses[0];
  const setStatus = (patientId, role, id, status) =>
    withPatient(patientId, role, (tx) =>
      tx`
        update dose_logs
           set status = ${status}::dose_status,
               taken_at = case when ${status}::dose_status = 'taken'
                               then coalesce(taken_at, now()) else null end
         where id = ${id}
         returning *
      `,
    );

  const [taken] = await setStatus(alice.id, "patient", target.id, "taken");
  check("marked taken", taken.status === "taken");
  check("taken_at set with it", taken.taken_at instanceof Date);

  const [untaken] = await setStatus(alice.id, "patient", target.id, "pending");
  check("un-marking clears taken_at", untaken.status === "pending" && untaken.taken_at === null);

  const [skipped] = await setStatus(alice.id, "patient", target.id, "skipped");
  check("marked skipped", skipped.status === "skipped" && skipped.taken_at === null);

  const [byCarer] = await setStatus(alice.id, "caregiver", target.id, "taken");
  check("caregiver may check a dose off", byCarer?.status === "taken");

  let dupRejected = false;
  try {
    await withPatient(alice.id, "patient", (tx) =>
      tx`insert into dose_logs (patient_id, medicine_id, schedule_date, slot)
         values (${alice.id}, ${target.medicine_id}, current_date, ${target.slot})`,
    );
  } catch {
    dupRejected = true;
  }
  check("unique (medicine, date, slot) enforced", dupRejected);

  // -----------------------------------------------------------------
  console.log("\n9. Row-level security");
  if (!rlsEnforced) {
    console.log("  SKIP  connected as a BYPASSRLS role; point DATABASE_URL at app_user to test this.");
  } else {
    await generate(bob.id, "patient");

    const crossRead = await withPatient(alice.id, "patient", (tx) =>
      tx`select id from patients where id = ${bob.id}`,
    );
    check("cannot read another patient's profile", crossRead.length === 0);

    const crossMeds = await withPatient(bob.id, "patient", (tx) =>
      tx`select id from medicines where patient_id = ${alice.id}`,
    );
    check("cannot read another patient's medicines", crossMeds.length === 0);

    // Set a known status as the owner first, so "unchanged" is meaningful.
    await setStatus(alice.id, "patient", target.id, "pending");
    const crossDose = await setStatus(bob.id, "patient", target.id, "taken");
    const [afterCross] = await withPatient(alice.id, "patient", (tx) =>
      tx`select status from dose_logs where id = ${target.id}`,
    );
    check(
      "cannot update another patient's dose",
      crossDose.length === 0 && afterCross.status === "pending",
      `${crossDose.length} rows updated, status still ${afterCross.status}`,
    );

    const noIdentity = await sql`select id from patients`;
    check("no identity returns no rows (fails closed)", noIdentity.length === 0, `${noIdentity.length} rows`);

    const carerWrite = await withPatient(alice.id, "caregiver", (tx) =>
      tx`update patients set name = 'Hacked' where id = ${alice.id} returning id`,
    );
    check("caregiver cannot edit the profile", carerWrite.length === 0);

    const carerMed = await withPatient(alice.id, "caregiver", (tx) =>
      tx`update medicines set dosage = '999 mg' where patient_id = ${alice.id} returning id`,
    );
    check("caregiver cannot change medicines", carerMed.length === 0);
  }
} catch (error) {
  fail += 1;
  console.error("\nUNEXPECTED ERROR:", error.message);
  if (error.detail) console.error("  detail:", error.detail);
  if (error.hint) console.error("  hint:", error.hint);
  if (error.position) console.error("  position:", error.position);
} finally {
  if (created.length && !keep) {
    // Cascades through medicines and dose_logs.
    await admin`delete from patients where id in ${admin(created)}`.catch(() => {});
    console.log(`\nCleaned up ${created.length} test patient(s).`);
  }
  await Promise.all([sql.end({ timeout: 5 }), admin.end({ timeout: 5 })]);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}
