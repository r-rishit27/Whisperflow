/**
 * End-to-end test of scan -> confirm -> dashboard, against a running dev
 * server, the real OpenAI model and the real database.
 *
 *   npm run dev
 *   node --env-file=.env scripts/verify-scan.mjs [--base http://localhost:3000] [--image rx.png]
 *
 * Without --image it renders the seeded test prescription from
 * scripts/fixtures/make-prescription.mjs, whose correct answers are known.
 *
 * The confirm step calls the `saveScan` server action exactly as the browser
 * does: looked up by name in the dev server's action manifest, then posted
 * with a Next-Action header. That manifest is a Next.js dev-build internal,
 * so this script is a test tool, not something the app depends on.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import postgres from "postgres";

const arg = (name, fallback) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;

const base = arg("--base", "http://localhost:3000");
let imagePath = arg("--image", null);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

const app = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
const admin = postgres(process.env.ADMIN_DATABASE_URL, { ssl: "require", max: 1 });

const sign = (payload) =>
  createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
const cookieFor = (patientId, role) =>
  `mm_session=${patientId}.${role}.${sign(`${patientId}.${role}`)}`;

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");

/** $ACTION_* hidden fields of the form that contains `marker`. */
function formFields(html, marker) {
  const form = [...html.matchAll(/<form[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((f) => f.includes(marker));
  if (!form) return null;
  const fields = [];
  for (const m of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
    if (name) fields.push([decode(name), decode(value)]);
  }
  return fields;
}

const patients = [];

try {
  console.log(`\nTesting ${base}`);

  // -----------------------------------------------------------------
  if (!imagePath) {
    imagePath = join(tmpdir(), `mm-rx-${Date.now()}.png`);
    execFileSync(process.execPath, ["scripts/fixtures/make-prescription.mjs", imagePath]);
  }
  if (!existsSync(imagePath)) throw new Error(`No image at ${imagePath}`);

  const [patient] = await app`
    select * from app.create_patient('Lakshmi Devi', 'en', 'Ravi', '+91 90000 22222', ${"SCN" + Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[01IO]/g, "Z")})
  `.catch(async () => app`select * from app.create_patient('Lakshmi Devi', 'en', 'Ravi', '+91 90000 22222', 'SCNZZZ')`);
  patients.push(patient.id);
  const cookie = cookieFor(patient.id, "patient");

  // -----------------------------------------------------------------
  console.log("\n1. Scan screen");
  const scanPage = await fetch(`${base}/scan`, { headers: { cookie } });
  const scanHtml = await scanPage.text();
  check("/scan renders for the patient", scanPage.status === 200);
  check("big camera button", scanHtml.includes("Take a photo"));
  check("upload button", scanHtml.includes("Upload a photo"));

  const carerScan = await fetch(`${base}/scan`, { headers: { cookie: cookieFor(patient.id, "caregiver") } });
  check("caregiver is told only the patient can add", (await carerScan.text()).includes("Only the patient can add medicines"));

  // -----------------------------------------------------------------
  console.log("\n2. /api/parse with the real model");
  const form = new FormData();
  form.append("image", new Blob([readFileSync(imagePath)], { type: "image/png" }), "rx.png");
  const t0 = Date.now();
  const parseRes = await fetch(`${base}/api/parse`, { method: "POST", body: form, headers: { cookie } });
  const parsed = await parseRes.json();
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  check("parse succeeded", parseRes.status === 200, `${parseRes.status} in ${seconds}s`);
  if (parseRes.status !== 200) throw new Error(parsed.error ?? "parse failed");

  const find = (needle) => parsed.medicines.find((m) => m.name.toLowerCase().includes(needle));
  const slotsOf = (m) => ["morning", "afternoon", "night"].filter((s) => m?.timings[s]).join("+");

  check("found all 5 medicines", parsed.medicines.length === 5, parsed.medicines.map((m) => m.name).join(", "));
  check("1-0-1 -> morning+night", slotsOf(find("dolo")) === "morning+night", slotsOf(find("dolo")));
  check("OD -> morning", slotsOf(find("telma")) === "morning", slotsOf(find("telma")));
  check("TDS -> all three", slotsOf(find("crocin")) === "morning+afternoon+night", slotsOf(find("crocin")));
  check("HS -> night", slotsOf(find("ecosprin")) === "night", slotsOf(find("ecosprin")));
  check("101 -> morning+night", slotsOf(find("brufen")) === "morning+night", slotsOf(find("brufen")));
  check("PC -> after food", find("dolo")?.food_instruction === "after_food");
  check("AC -> before food", find("telma")?.food_instruction === "before_food");
  check("'x 5 days' -> 5", find("dolo")?.duration_days === 5);
  check("'continue' -> ongoing (null)", find("telma")?.duration_days === null);

  const dup = parsed.warnings.find((w) => w.kind === "duplicate");
  check("duplicate paracetamol flagged", Boolean(dup) && /dolo|crocin/i.test(dup.medicines.join(" ")), dup ? `${dup.severity}: ${dup.explanation}` : "none");
  const nsaid = parsed.warnings.find((w) => w.kind === "interaction" && /brufen|ibuprofen/i.test(w.medicines.join(" ")) && /ecosprin|aspirin/i.test(w.medicines.join(" ")));
  check("ibuprofen + aspirin interaction flagged", Boolean(nsaid), nsaid ? `${nsaid.severity}: ${nsaid.explanation}` : "none");
  check("every warning has a severity", parsed.warnings.every((w) => ["high", "moderate", "low"].includes(w.severity)));

  // -----------------------------------------------------------------
  console.log("\n3. Confirm and save (saveScan server action)");
  // Simulate the patient correcting a mistake before saving: they drop the
  // duplicate Crocin and change Telma's dose.
  const edited = parsed.medicines
    .filter((m) => !/crocin/i.test(m.name))
    .map((m) => ({
      name: m.name,
      dosage: /telma/i.test(m.name) ? "½ tablet" : m.dosage,
      timeSlots: ["morning", "afternoon", "night"].filter((s) => m.timings[s]),
      foodInstruction: m.food_instruction,
      durationDays: m.duration_days,
    }));

  const manifestPath = ".next/dev/server/app/scan/page/server-reference-manifest.json";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const actionId = Object.entries(manifest.node).find(([, v]) => v.exportedName === "saveScan")?.[0];
  check("saveScan action located", Boolean(actionId));

  const saveRes = await fetch(`${base}/scan`, {
    method: "POST",
    headers: {
      cookie,
      "Next-Action": actionId,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
    },
    body: JSON.stringify([edited]),
    redirect: "manual",
  });
  const redirectTo = saveRes.headers.get("x-action-redirect") ?? saveRes.headers.get("location") ?? "";
  check("save redirected to the dashboard", redirectTo.startsWith("/?added=4"), `${saveRes.status} -> ${redirectTo || "(none)"}`);

  const meds = await admin`select name, dosage, time_slots, duration_days, created_at from medicines where patient_id = ${patient.id} order by name`;
  check("4 medicines saved (edited list)", meds.length === 4, meds.map((m) => m.name).join(", "));
  check("patient's edit was kept", meds.find((m) => /telma/i.test(m.name))?.dosage === "½ tablet");
  check("removed medicine was not saved", !meds.some((m) => /crocin/i.test(m.name)));

  // Expected rows: each slot for 7 days, capped by course length, minus any
  // of today's slots already >2h overdue at the moment of saving.
  const istParts = (d) => {
    const s = new Date(d.getTime() + 5.5 * 3600e3);
    return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate() };
  };
  const dueAt = (day, slot) => {
    const h = { morning: 8, afternoon: 13, night: 21 }[slot];
    return new Date(Date.UTC(day.y, day.m, day.d, h, 0) - 5.5 * 3600e3);
  };
  let expected = 0;
  for (const m of meds) {
    const start = istParts(m.created_at);
    const days = Math.min(7, m.duration_days ?? 7);
    for (let i = 0; i < days; i += 1) {
      const day = { ...start, d: start.d + i };
      for (const slot of m.time_slots) {
        if (dueAt(day, slot).getTime() >= m.created_at.getTime() - 2 * 3600e3) expected += 1;
      }
    }
  }
  const [{ n: doseRows }] = await admin`select count(*)::int as n from dose_logs where patient_id = ${patient.id}`;
  check("dose rows created for the next 7 days", doseRows === expected, `${doseRows} rows (expected ${expected})`);

  const [{ days }] = await admin`select count(distinct schedule_date)::int as days from dose_logs where patient_id = ${patient.id}`;
  check("spread across 7 dates", days === 7, `${days} dates`);

  const [{ n: maxDolo }] = await admin`
    select count(distinct d.schedule_date)::int as n from dose_logs d join medicines m on m.id = d.medicine_id
     where d.patient_id = ${patient.id} and m.name ilike '%dolo%'`;
  check("5-day course stops after 5 days", maxDolo <= 5, `${maxDolo} dates`);

  // -----------------------------------------------------------------
  console.log("\n4. Dashboard");
  // Plant a dose that is overdue right now: today's morning slot for the
  // ongoing medicine, as if the patient had been on it already.
  const [telma] = await admin`select id from medicines where patient_id = ${patient.id} and name ilike '%telma%'`;
  const [ecosprin] = await admin`select id from medicines where patient_id = ${patient.id} and name ilike '%ecosprin%'`;
  const [{ hour }] = await admin`select extract(hour from now() at time zone 'Asia/Kolkata')::int as hour`;
  const overdueSlot = hour >= 10 ? "morning" : null; // 8 AM + 2h
  if (overdueSlot) {
    await admin`
      insert into dose_logs (patient_id, medicine_id, schedule_date, slot)
      values (${patient.id}, ${telma.id}, app.today(), ${overdueSlot})
      on conflict do nothing`;
  }

  const dash = await fetch(`${base}/?added=4`, { headers: { cookie } });
  const rawHtml = await dash.text();
  // React separates adjacent text nodes with <!-- --> in server HTML;
  // strip them so visible sentences can be matched as written.
  const html = rawHtml.replace(/<!-- -->/g, "");
  check("dashboard renders", dash.status === 200);
  check("greets the patient by name", /Good (morning|afternoon|evening), Lakshmi/.test(html), /Good \w+, \w+/.exec(html)?.[0]);
  check("'added' confirmation shown", html.includes("4 medicines added"));
  check("progress ring present", /role="img" aria-label="\d+ of \d+ doses taken today"/.test(html), /aria-label="(\d+ of \d+ doses taken today)"/.exec(html)?.[1]);
  check("grouped by slot with times", html.includes("8:00 AM") || html.includes("1:00 PM") || html.includes("9:00 PM"));
  check("green Taken button", html.includes("bg-success") && /Taken<\/button>/.test(html));
  check("gray Skip button", html.includes("Skip"));
  check("next dose highlighted", html.includes("glow") && (html.includes("Take now") || html.includes("Next dose")), html.includes("Take now") ? "Take now" : "Next dose");

  if (overdueSlot) {
    const [planted] = await admin`select status from dose_logs where patient_id = ${patient.id} and medicine_id = ${telma.id} and schedule_date = app.today() and slot = ${overdueSlot}`;
    check("overdue dose marked missed in the database on load", planted?.status === "missed", planted?.status);
    check("missed dose shown in red", html.includes("Missed") && html.includes("border-danger"));
  } else {
    console.log("  SKIP  before 10 AM IST, so no slot is >2h overdue yet");
  }

  // -----------------------------------------------------------------
  console.log("\n5. Taken / Skip update the database");
  const pending = await admin`
    select d.id from dose_logs d where d.patient_id = ${patient.id}
       and d.schedule_date = app.today() and d.status in ('pending','missed')
     order by app.dose_due_at(d.schedule_date, d.slot)`;

  if (pending.length >= 1) {
    const fields = formFields(rawHtml, `value="${pending[0].id}"`);
    const body = new FormData();
    for (const [k, v] of fields) if (k.startsWith("$ACTION")) body.append(k, v);
    body.append("doseId", pending[0].id);
    body.append("status", "taken");
    const r = await fetch(`${base}/`, { method: "POST", headers: { cookie }, body, redirect: "manual" });
    const [row] = await admin`select status, taken_at from dose_logs where id = ${pending[0].id}`;
    check("Taken updates Supabase", row.status === "taken" && row.taken_at !== null, `${r.status} -> ${row.status}`);
  }

  // A future dose, to test Skip without it being re-marked missed.
  const [future] = await admin`
    select id from dose_logs where patient_id = ${patient.id} and status = 'pending'
       and schedule_date = app.today() and medicine_id = ${ecosprin.id}`;
  if (future) {
    const fields = formFields(rawHtml, `value="${future.id}"`);
    const body = new FormData();
    for (const [k, v] of fields) if (k.startsWith("$ACTION")) body.append(k, v);
    body.append("doseId", future.id);
    body.append("status", "skipped");
    await fetch(`${base}/`, { method: "POST", headers: { cookie }, body, redirect: "manual" });
    const [row] = await admin`select status from dose_logs where id = ${future.id}`;
    check("Skip updates Supabase", row.status === "skipped", row.status);
  }

  const after = await (await fetch(`${base}/`, { headers: { cookie } })).text();
  const ring = /aria-label="(\d+) of (\d+) doses taken today"/.exec(after);
  check("progress ring counts the taken dose", ring && Number(ring[1]) >= 1, ring ? `${ring[1]} of ${ring[2]}` : "not found");
} catch (error) {
  fail += 1;
  console.error("\nUNEXPECTED ERROR:", error.message);
} finally {
  if (patients.length) {
    await admin`delete from patients where id in ${admin(patients)}`.catch(() => {});
    console.log(`\nCleaned up ${patients.length} test patient(s).`);
  }
  await Promise.all([app.end({ timeout: 5 }), admin.end({ timeout: 5 })]);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}
