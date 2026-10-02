/**
 * End-to-end test of the family dashboard, the Family tab, the reminder
 * feed and the voice screen, against a running dev server and the real
 * database.
 *
 *   npm run dev
 *   node --env-file=.env scripts/verify-family.mjs [--base http://localhost:3000]
 *
 * Builds a patient with four days of real history (via the same backfill
 * the app uses), then checks the public page's numbers against the
 * database rather than against hard-coded expectations.
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
  return `mm_session=${payload}.${createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url")}`;
};
// React separates adjacent text nodes with <!-- --> in server HTML.
const visible = (html) => html.replace(/<!-- -->/g, "");
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const created = [];

try {
  console.log(`\nTesting ${base}`);

  const code = Array.from({ length: 6 }, () => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 32)]).join("");
  const [patient] = await app`select * from app.create_patient('Meera Iyer', 'en', 'Arjun', '+91 90000 33333', ${code})`;
  created.push(patient.id);
  const cookie = cookieFor(patient.id, "patient");

  // Two medicines, on them for 4 days.
  for (const name of ["Metformin 500", "Amlodipine 5"]) {
    await admin`
      insert into medicines (patient_id, name, dosage, time_slots, food_instruction, created_at)
      values (${patient.id}, ${name}, '1 tablet', ${`{${(["morning", "night"]).join(",")}}`}::text[], 'after_food', now() - interval '4 days')`;
  }

  // -----------------------------------------------------------------
  console.log("\n1. Public family page (no sign-in)");
  // First load backfills the last 7 days and marks the past as missed.
  const first = await fetch(`${base}/family/${code}`);
  check("renders without a session", first.status === 200, `${first.status}`);

  // Shape some history: yesterday fully taken, the day before half taken.
  await admin`
    update dose_logs set status = 'taken', taken_at = now() - interval '1 day'
     where patient_id = ${patient.id} and schedule_date = app.today() - 1`;
  await admin`
    update dose_logs set status = 'taken', taken_at = now() - interval '2 days'
     where patient_id = ${patient.id} and schedule_date = app.today() - 2 and slot = 'morning'`;
  // Today: both morning doses missed, so the alert threshold (2) is met
  // regardless of the time this runs.
  await admin`
    update dose_logs set status = 'missed', taken_at = null
     where patient_id = ${patient.id} and schedule_date = app.today() and slot = 'morning'`;

  const res = await fetch(`${base}/family/${code}`);
  const raw = await res.text();
  const html = visible(raw);
  check("shows the patient's first name", html.includes("Meera’s medicines") || html.includes("Meera&#x27;s medicines") || html.includes("Meera&rsquo;s medicines") || /Meera.{1,8}s medicines/.test(html));
  check("red alert for 2+ missed today", html.includes("doses missed today") && html.includes('role="alert"'), /(\d+) doses missed today/.exec(html)?.[0]);
  check("alert names the medicines", html.includes("Metformin 500") && html.includes("Amlodipine 5"));

  const [t] = await admin`
    select count(*) filter (where status = 'taken')::int as taken,
           count(*) filter (where status in ('taken','missed','skipped'))::int as due
      from dose_logs where patient_id = ${patient.id} and schedule_date = app.today()`;
  const expectedPct = t.due === 0 ? null : Math.round((t.taken / t.due) * 100);
  check("today's adherence % matches the database", expectedPct === null ? html.includes("No doses due yet") : html.includes(`${expectedPct}%`), `${expectedPct}%`);

  // The 7-day table is server-rendered alongside the (client-only) chart.
  const rows = [...html.matchAll(/<tr class="border-t[^"]*"><th scope="row"[^>]*>([^<]+)<\/th><td[^>]*>(\d+)<\/td><td[^>]*>(\d+)<\/td>/g)];
  check("7 days in the table", rows.length === 7, `${rows.length} rows`);
  check("last row is Today", rows.at(-1)?.[1] === "Today");

  const days = await admin`
    select to_char(d, 'YYYY-MM-DD') as date,
           count(l.id) filter (where l.status = 'taken')::int as taken,
           count(l.id) filter (where l.status = 'missed')::int as missed
      from generate_series(app.today() - 6, app.today(), interval '1 day') d
      left join dose_logs l on l.schedule_date = d::date and l.patient_id = ${patient.id}
     group by d order by d`;
  const tableMatches = rows.every((r, i) => Number(r[2]) === days[i].taken && Number(r[3]) === days[i].missed);
  check("every day's taken/missed matches the database", tableMatches, days.map((d) => `${d.taken}/${d.missed}`).join(" "));
  check("history backfilled as missed (not dropped)", days.slice(2, 4).some((d) => d.missed > 0), "day -3/-4 show missed doses");
  check("days before the medicine started are empty", days[0].taken + days[0].missed === 0);

  check("missed shown in red in the table", /font-bold text-danger">\d+</.test(raw));
  check("chart legend rendered", ["Taken", "Missed", "Skipped", "Coming up"].every((l) => html.includes(l)));
  check("chart colours are the validated tokens", raw.includes("var(--color-chart-missed)") && raw.includes("var(--color-chart-taken)"));
  check("today's dose list with statuses", html.includes("Today’s doses") || html.includes("Today&rsquo;s doses") || /Today.{1,8}s doses/.test(html));
  check("hidden from search engines", /<meta name="robots" content="noindex, nofollow/.test(raw));
  check("no app navigation for visitors", !raw.includes('aria-label="Main"'));

  // The loading screen streams before the lookup finishes, so the status
  // can be 200; what matters is the friendly not-found page and noindex.
  const notFoundPage = async (path) => {
    const r = await fetch(`${base}${path}`);
    const body = await r.text();
    return (r.status === 404 || r.status === 200) && body.includes("We could not find that page") && !body.includes("doses missed today");
  };
  check("malformed code -> friendly not-found", await notFoundPage("/family/NOPE01"));
  check("unknown code -> friendly not-found", code === "ZZZZZZ" || (await notFoundPage("/family/ZZZZZZ")));

  // -----------------------------------------------------------------
  console.log("\n2. Family tab (patient)");
  const tab = await fetch(`${base}/family`, { headers: { cookie } });
  const tabRaw = await tab.text();
  const tabHtml = visible(tabRaw);
  check("renders", tab.status === 200);
  check("shows the share code", tabHtml.includes(code));
  check("share link points at the public page", tabHtml.includes(`/family/${code}`));
  check("copy button", tabHtml.includes("Copy link"));

  const wa = /href="(https:\/\/wa\.me\/\?text=[^"]+)"/.exec(tabRaw)?.[1];
  const waText = wa ? decodeURIComponent(decode(wa).split("text=")[1]) : "";
  check("WhatsApp button opens wa.me with text", Boolean(wa));
  check("pre-filled message contains the link", waText.includes(`/family/${code}`), waText);
  check("message mentions the missed doses", /missed \d+ medicine doses today/.test(waText));
  check("red banner on the tab too", tabHtml.includes("doses missed today"));

  // -----------------------------------------------------------------
  console.log("\n3. Reminder feed (/api/doses/today)");
  const anon = await fetch(`${base}/api/doses/today`);
  check("no session -> 401", anon.status === 401);
  const feed = await fetch(`${base}/api/doses/today`, { headers: { cookie } });
  const doses = await feed.json();
  check("returns today's doses", feed.status === 200 && Array.isArray(doses) && doses.length === 4, `${doses.length} doses`);
  check("due_at is ISO, slot time in IST", doses.some((d) => d.slot === "morning" && d.due_at.endsWith("T02:30:00.000Z")), doses.find((d) => d.slot === "morning")?.due_at);
  check("not cached", feed.headers.get("cache-control")?.includes("no-store"));

  const layout = await fetch(`${base}/`, { headers: { cookie } });
  check("app still renders with reminders mounted", layout.status === 200);

  // -----------------------------------------------------------------
  console.log("\n4. Voice screen");
  const voice = visible(await (await fetch(`${base}/voice`, { headers: { cookie } })).text());
  check("huge mic button", voice.includes('aria-label="Talk to MediMitra"') && voice.includes("size-44"));
  check("greets by name", voice.includes("Namaste Meera"));
  const carerVoice = visible(await (await fetch(`${base}/voice`, { headers: { cookie: cookieFor(patient.id, "caregiver") } })).text());
  check("caregiver gets an explanation instead", carerVoice.includes("talks with the patient"));
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
