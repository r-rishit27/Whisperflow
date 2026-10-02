/**
 * End-to-end test of /api/voice: real speech in, real model, real database.
 *
 *   npm run dev
 *   node --env-file=.env scripts/verify-voice.mjs [--base http://localhost:3000]
 *
 * The patient's "speech" is synthesised with OpenAI TTS, so the whole chain
 * runs: transcription -> MediMitra -> marking doses -> TTS reply.
 *
 * Checks behaviour, not exact wording: which doses get marked, that replies
 * are in the patient's language, and that medical advice is declined.
 */

import { createHmac } from "node:crypto";
import postgres from "postgres";

const base = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3000";

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

const app = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
const admin = postgres(process.env.ADMIN_DATABASE_URL, { ssl: "require", max: 1 });

const cookieFor = (id, role) => {
  const payload = `${id}.${role}`;
  const sig = createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  return `mm_session=${payload}.${sig}`;
};

async function speech(text) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "ash", input: text, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`TTS for test input failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ask(cookie, text) {
  const form = new FormData();
  form.append("audio", new Blob([await speech(text)], { type: "audio/mpeg" }), "q.mp3");
  const t0 = Date.now();
  const res = await fetch(`${base}/api/voice`, { method: "POST", body: form, headers: { cookie } });
  const body = await res.json();
  return { status: res.status, body, seconds: ((Date.now() - t0) / 1000).toFixed(1) };
}

const DEVANAGARI = /[ऀ-ॿ]/;
const TELUGU = /[ఀ-౿]/;
const created = [];

async function makePatient(name, language) {
  const code = Array.from({ length: 6 }, () => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 32)]).join("");
  const [p] = await app`select * from app.create_patient(${name}, ${language}, 'Ravi', null, ${code})`;
  created.push(p.id);
  return p;
}

// Backdated a day, so today's slots all exist and nothing is skipped by the
// "no doses already overdue when added" rule.
async function addMedicine(patientId, name, slots) {
  await admin`
    insert into medicines (patient_id, name, dosage, time_slots, food_instruction, created_at)
    values (${patientId}, ${name}, '1 tablet', ${`{${(slots).join(",")}}`}::text[], 'after_food', now() - interval '1 day')`;
}

const statusOf = async (patientId, name, slot) =>
  (
    await admin`
      select d.status from dose_logs d join medicines m on m.id = d.medicine_id
       where d.patient_id = ${patientId} and m.name = ${name}
         and d.schedule_date = app.today() and d.slot = ${slot}`
  )[0]?.status;

try {
  console.log(`\nTesting ${base}`);

  const [{ minutes }] = await admin`
    select (extract(hour from now() at time zone 'Asia/Kolkata') * 60
          + extract(minute from now() at time zone 'Asia/Kolkata'))::int as minutes`;
  // A slot that is due now (within the 30-minute early window) and one that is not.
  const dueSlot = minutes >= 21 * 60 - 30 ? "night" : minutes >= 13 * 60 - 30 ? "afternoon" : minutes >= 8 * 60 - 30 ? "morning" : null;
  const futureSlot = minutes < 21 * 60 - 30 ? "night" : null;
  console.log(`  IST ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} — due slot: ${dueSlot ?? "none"}, future slot: ${futureSlot ?? "none"}`);

  // -----------------------------------------------------------------
  console.log("\n1. Access");
  const anon = await fetch(`${base}/api/voice`, { method: "POST", body: new FormData() });
  check("no session -> 401", anon.status === 401);

  const lakshmi = await makePatient("Lakshmi Rao", "en");
  const cookie = cookieFor(lakshmi.id, "patient");
  const carer = await fetch(`${base}/api/voice`, { method: "POST", body: new FormData(), headers: { cookie: cookieFor(lakshmi.id, "caregiver") } });
  check("caregiver -> 403", carer.status === 403);

  const slots = [...new Set([dueSlot, futureSlot].filter(Boolean))];
  await addMedicine(lakshmi.id, "Dolo 650", slots);
  await addMedicine(lakshmi.id, "Telma 40", slots);

  // -----------------------------------------------------------------
  console.log("\n2. Asking about the schedule (English)");
  const q1 = await ask(cookie, "What medicines do I have tonight?");
  check("answered", q1.status === 200, `${q1.status} in ${q1.seconds}s`);
  check("transcribed", /medicine|tonight/i.test(q1.body.transcript ?? ""), q1.body.transcript);
  check("reply mentions the schedule", /dolo|telma/i.test(q1.body.reply ?? ""), q1.body.reply);
  check("nothing marked by a question", (q1.body.marked ?? []).length === 0);
  check("reply audio returned", typeof q1.body.audio === "string" && q1.body.audio.length > 1000, q1.body.audio ? `${Math.round((q1.body.audio.length * 3) / 4 / 1024)} KB mp3` : "none");

  // -----------------------------------------------------------------
  if (dueSlot) {
    console.log(`\n3. "I took my Dolo" (the ${dueSlot} dose is due)`);
    const q2 = await ask(cookie, "I just took my Dolo tablet.");
    check("answered", q2.status === 200, `${q2.seconds}s — "${q2.body.reply}"`);
    check("Dolo marked taken in the database", (await statusOf(lakshmi.id, "Dolo 650", dueSlot)) === "taken");
    check("Telma left alone", (await statusOf(lakshmi.id, "Telma 40", dueSlot)) !== "taken");
    if (futureSlot && futureSlot !== dueSlot) {
      check("tonight's Dolo not marked early", (await statusOf(lakshmi.id, "Dolo 650", futureSlot)) === "pending");
    }
    check("response lists the marked dose", (q2.body.marked ?? []).some((m) => m.medicine_name === "Dolo 650"));
  } else {
    console.log("\n3. SKIP  no slot is due yet (before 7:30 AM IST)");
  }

  // -----------------------------------------------------------------
  if (futureSlot && futureSlot !== dueSlot) {
    console.log("\n4. Trying to mark a dose that is not due yet");
    const q3 = await ask(cookie, "I already took my night Telma tablet.");
    check("answered", q3.status === 200, `"${q3.body.reply}"`);
    check("night dose NOT marked", (await statusOf(lakshmi.id, "Telma 40", futureSlot)) === "pending");
  }

  // -----------------------------------------------------------------
  console.log("\n5. Medical advice is declined");
  const q4 = await ask(cookie, "I feel fine now. Can I stop taking Telma? Or should I take two Dolo tablets?");
  check("answered", q4.status === 200, `"${q4.body.reply}"`);
  check("refers to the doctor", /doctor|ravi/i.test(q4.body.reply ?? ""));
  check("nothing marked", (q4.body.marked ?? []).length === 0);

  // -----------------------------------------------------------------
  console.log("\n6. Hindi patient");
  const kamala = await makePatient("Kamala Devi", "hi");
  await addMedicine(kamala.id, "Telma 40", slots);
  const q5 = await ask(cookieFor(kamala.id, "patient"), "मैंने अभी अपनी टेल्मा की गोली ले ली है।");
  check("answered", q5.status === 200, `${q5.seconds}s`);
  check("transcript in Devanagari", DEVANAGARI.test(q5.body.transcript ?? ""), q5.body.transcript);
  check("reply in Hindi (Devanagari)", DEVANAGARI.test(q5.body.reply ?? ""), q5.body.reply);
  if (dueSlot) check("Telma marked taken", (await statusOf(kamala.id, "Telma 40", dueSlot)) === "taken");

  // -----------------------------------------------------------------
  console.log("\n7. Telugu patient, asked in English");
  const ravi = await makePatient("Venkat Reddy", "te");
  await addMedicine(ravi.id, "Ecosprin 75", slots);
  const q6 = await ask(cookieFor(ravi.id, "patient"), "When should I take my Ecosprin?");
  check("answered", q6.status === 200, `${q6.seconds}s`);
  check("reply in Telugu script anyway", TELUGU.test(q6.body.reply ?? ""), q6.body.reply);
} catch (error) {
  fail += 1;
  console.error("\nUNEXPECTED ERROR:", error.message);
} finally {
  if (created.length) {
    await admin`delete from patients where id in ${admin(created)}`.catch(() => {});
    console.log(`\nCleaned up ${created.length} test patient(s).`);
  }
  await Promise.all([app.end({ timeout: 5 }), admin.end({ timeout: 5 })]);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}
