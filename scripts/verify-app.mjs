/**
 * End-to-end test of the running app: onboarding -> welcome -> Today ->
 * marking a dose -> registration -> sign-in, all over HTTP against a dev
 * server and the real database.
 *
 *   npm run dev            # in one terminal
 *   node --env-file=.env scripts/verify-app.mjs [--base http://localhost:3000]
 *
 * Drives the server actions through their no-JS progressive-enhancement
 * fields, so this also proves the app works without client JavaScript.
 *
 * Test patients are deleted at the end via ADMIN_DATABASE_URL.
 */

import postgres from "postgres";

const base =
  process.argv.includes("--base")
    ? process.argv[process.argv.indexOf("--base") + 1]
    : "http://localhost:3000";

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

// --- tiny cookie jar -------------------------------------------------
let jar = new Map();
const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

function storeCookies(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === "" || /expires=thu, 01 jan 1970/i.test(raw)) jar.delete(name);
    else jar.set(name, value);
  }
}

async function get(path) {
  const res = await fetch(base + path, {
    headers: { cookie: cookieHeader() },
    redirect: "manual",
  });
  storeCookies(res);
  return res;
}

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'");

/** Pulls the $ACTION_* hidden fields Next renders for no-JS form posts. */
function actionFields(html, formIndex = 0) {
  const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);
  const form = forms[formIndex];
  if (!form) return null;

  const fields = [];
  for (const m of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
    if (name?.startsWith("$ACTION")) fields.push([decode(name), decode(value)]);
  }
  return fields.length ? fields : null;
}

/** Posts a server action the way a browser without JS would. */
async function postAction(path, actions, data) {
  const body = new FormData();
  for (const [k, v] of actions) body.append(k, v);
  for (const [k, v] of Object.entries(data)) body.append(k, v);

  const res = await fetch(base + path, {
    method: "POST",
    headers: { cookie: cookieHeader() },
    body,
    redirect: "manual",
  });
  storeCookies(res);
  return res;
}

const created = [];
const admin = process.env.ADMIN_DATABASE_URL
  ? postgres(process.env.ADMIN_DATABASE_URL, { ssl: "require", max: 1 })
  : null;
const app = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

try {
  console.log(`\nTesting ${base}`);

  // -----------------------------------------------------------------
  console.log("\n1. Unauthenticated routing");
  const root = await get("/");
  check("/ redirects to onboarding", root.status === 307 && (root.headers.get("location") ?? "").includes("/onboarding"), `${root.status} -> ${root.headers.get("location")}`);

  const onboarding = await get("/onboarding");
  const onboardingHtml = await onboarding.text();
  check("/onboarding renders", onboarding.status === 200);
  check("three language choices shown", ["English", "हिन्दी", "తెలుగు"].every((l) => onboardingHtml.includes(l)));
  check("caregiver fields present", onboardingHtml.includes('name="caregiverName"') && onboardingHtml.includes('name="caregiverPhone"'));
  check("first screen offers sign-in to returning patients", onboardingHtml.includes("Already using MediMantra?") && onboardingHtml.includes('href="/login?lang=en"'));
  check("first screen links family members to code sign-in", onboardingHtml.includes('href="/login?tab=family&amp;lang=en"'));

  // -----------------------------------------------------------------
  console.log("\n2. Onboarding (server action, no JS)");
  const fields = actionFields(onboardingHtml);
  if (!fields) throw new Error("Could not find the action fields on /onboarding");

  const submit = await postAction("/onboarding", fields, {
    name: "E2E Patient",
    language: "en", // English UI so the assertions below can read it; i18n is covered by verify-i18n.mjs
    caregiverName: "E2E Carer",
    caregiverPhone: "+91 90000 12345",
  });
  check("action accepted", submit.status < 400 || submit.status === 303, `status ${submit.status}`);
  check("session cookie set", jar.has("mm_session"), jar.has("mm_session") ? "mm_session present" : "no cookie");

  const cookieValue = jar.get("mm_session") ?? "";
  check("cookie is signed (3 parts)", cookieValue.split(".").length === 3);
  const patientId = cookieValue.split(".")[0];
  if (patientId) created.push(patientId);

  const [row] = await app`
    select set_config('app.current_patient', ${patientId}, true)
  `.then(() =>
    app`select name, language, caregiver_name from patients where id = ${patientId}`,
  ).catch(() => [null]);

  // Read it back through the owner, since the identity above is not in the
  // same transaction as the select.
  const dbRow = admin
    ? (await admin`select name, language, caregiver_name from patients where id = ${patientId}`)[0]
    : row;
  check("patient persisted to the database", dbRow?.name === "E2E Patient", dbRow ? `${dbRow.name} / ${dbRow.language}` : "not found");
  check("language saved as chosen", dbRow?.language === "en", dbRow?.language);
  check("caregiver saved", dbRow?.caregiver_name === "E2E Carer", dbRow?.caregiver_name ?? "null");

  // -----------------------------------------------------------------
  console.log("\n3. Welcome screen");
  const welcome = await get("/welcome");
  const welcomeHtml = await welcome.text();
  check("/welcome renders", welcome.status === 200);
  check("greets the patient by name", welcomeHtml.replace(/<!-- -->/g, "").includes("All set, E2E"));
  check("shows the patient ID", welcomeHtml.includes(patientId));
  const shareCode = /tracking-\[0\.2em\]">([2-9A-HJ-NP-Z]{6})</.exec(welcomeHtml)?.[1];
  check("shows a 6-character share code", Boolean(shareCode), shareCode ?? "not found");

  // -----------------------------------------------------------------
  console.log("\n4. Onboarding is skipped once a patient exists");
  const onboardingAgain = await get("/onboarding");
  check("/onboarding now redirects to /", onboardingAgain.status === 307 && onboardingAgain.headers.get("location")?.endsWith("/"), `${onboardingAgain.status} -> ${onboardingAgain.headers.get("location")}`);

  const loginWhileSignedIn = await get("/login");
  check("/login also redirects to /", loginWhileSignedIn.status === 307);

  // -----------------------------------------------------------------
  console.log("\n5. Today screen (empty state)");
  const empty = await get("/");
  const emptyHtml = await empty.text();
  check("/ renders Today", empty.status === 200);
  check("shows the empty state", emptyHtml.includes("No medicines for today"));

  // -----------------------------------------------------------------
  console.log("\n6. Today screen with medicines");
  // Backdated a day, as if the patient has been on it a while, so all of
  // today's slots exist whatever time this runs. (The first-day rule --
  // no doses already overdue when a medicine is added -- is covered by
  // verify-scan.mjs.)
  await admin`
    insert into medicines (patient_id, name, dosage, time_slots, food_instruction, duration_days, created_at)
    values (${patientId}, 'E2E Metformin', '500 mg', ${`{${(["morning", "night"]).join(",")}}`}::text[], 'after_food', 30, now() - interval '1 day')
  `;

  // Visible text, without React's <!-- --> text-node separators.
  const visible = (html) => html.replace(/<!-- -->/g, "");
  // The page's own summary must agree with the database after the load
  // has marked anything overdue as missed.
  const expectedSummary = async () => {
    const [c] = await admin`
      select count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'missed')::int as missed
        from dose_logs where patient_id = ${patientId} and schedule_date = app.today()`;
    return c.pending > 0 ? `${c.pending} still to take` : c.missed > 0 ? "Nothing left to take today" : "All done for today";
  };

  const withMeds = await get("/");
  const withMedsHtml = await withMeds.text();
  check("medicine name rendered", withMedsHtml.includes("E2E Metformin"));
  check("dosage rendered", withMedsHtml.includes("500 mg"));
  check("food instruction rendered", withMedsHtml.includes("After food"));
  check("both slots rendered", withMedsHtml.includes("Morning") && withMedsHtml.includes("Night"));
  const summary = await expectedSummary();
  check("summary matches the database", visible(withMedsHtml).includes(summary), summary);
  check("doses were generated in the database", true, `${(await admin`select count(*)::int as n from dose_logs where patient_id = ${patientId}`)[0].n} rows`);

  // -----------------------------------------------------------------
  console.log("\n7. Marking a dose taken (server action, no JS)");
  const doseFields = actionFields(withMedsHtml, 0);
  const doseId = /name="doseId" value="([0-9a-f-]{36})"/.exec(withMedsHtml)?.[1];
  check("dose form found", Boolean(doseFields && doseId), doseId ? `dose ${doseId.slice(0, 8)}…` : "not found");

  if (doseFields && doseId) {
    const marked = await postAction("/", doseFields, { doseId, status: "taken" });
    check("mark-taken action accepted", marked.status < 400, `status ${marked.status}`);

    const [dose] = await admin`select status, taken_at from dose_logs where id = ${doseId}`;
    check("dose is taken in the database", dose.status === "taken", dose.status);
    check("taken_at was set", dose.taken_at !== null);

    const after = await get("/");
    const afterHtml = visible(await after.text());
    const afterSummary = await expectedSummary();
    check("Today reflects it", afterHtml.includes(afterSummary) && /aria-label="1 of 2 doses taken today"/.test(afterHtml), afterSummary);
  }

  // -----------------------------------------------------------------
  console.log("\n8. Registration and sign-in");
  jar = new Map(); // sign out

  const loginPage = await get("/login?tab=register");
  const loginHtml = await loginPage.text();
  check("/login renders when signed out", loginPage.status === 200);
  check("register tab present", loginHtml.includes("Choose a password"));

  // Only the active tab's form is server-rendered, so ?tab= selects which
  // form appears and it is always the first one on the page.
  const registerFields = actionFields(loginHtml, 0);
  if (!registerFields) throw new Error("Could not find the register form fields");

  const registered = await postAction("/login", registerFields, {
    patientId,
    password: "medimantra-test-pw",
    confirm: "medimantra-test-pw",
  });
  check("register action accepted", registered.status < 400, `status ${registered.status}`);
  check("session cookie issued", jar.has("mm_session"));

  const [hashRow] = await admin`select password_hash from patients where id = ${patientId}`;
  check("password hashed with scrypt", hashRow.password_hash?.startsWith("scrypt:"), hashRow.password_hash?.slice(0, 20));
  check("plaintext password not stored", !hashRow.password_hash?.includes("medimantra-test-pw"));

  // Re-registering the same id must be refused.
  jar = new Map();
  const reLoginPage = await get("/login?tab=register");
  const reFields = actionFields(await reLoginPage.text(), 0);
  const reRegistered = await postAction("/login", reFields, {
    patientId,
    password: "another-password",
    confirm: "another-password",
  });
  const reBody = await reRegistered.text();
  check("re-registration refused", reBody.includes("already registered"), reBody.includes("already registered") ? "shows 'already registered'" : "no error shown");
  check("no session granted on refusal", !jar.has("mm_session"));

  // Wrong password.
  jar = new Map();
  const signinPage = await get("/login");
  const signinFields = actionFields(await signinPage.text(), 0);
  const badSignin = await postAction("/login", signinFields, {
    identifier: patientId,
    password: "wrong-password",
  });
  const badBody = await badSignin.text();
  check("wrong password rejected", badBody.includes("do not match"));
  check("no session on bad password", !jar.has("mm_session"));

  // Correct password.
  jar = new Map();
  const goodPage = await get("/login");
  const goodFields = actionFields(await goodPage.text(), 0);
  const goodSignin = await postAction("/login", goodFields, {
    identifier: patientId,
    password: "medimantra-test-pw",
  });
  check("correct password accepted (patient ID)", goodSignin.status < 400 && jar.has("mm_session"), `status ${goodSignin.status}`);

  const signedIn = await get("/");
  const signedInHtml = await signedIn.text();
  check("signed-in Today shows the patient's medicine", signedInHtml.includes("E2E Metformin"));

  // ---------------------------------------------------------------
  console.log("\n8b. Sign in with the family code (returning patient, new phone)");
  if (shareCode) {
    const signInWith = async (identifier, password) => {
      jar = new Map();
      const page = await get("/login");
      const fields = actionFields(await page.text(), 0);
      const res = await postAction("/login", fields, { identifier, password });
      return { res, body: await res.text(), cookie: jar.get("mm_session") ?? "" };
    };

    const byCode = await signInWith(shareCode, "medimantra-test-pw");
    check("family code + password signs the patient in", byCode.res.status < 400 && byCode.cookie.startsWith(`${patientId}.patient.`), `status ${byCode.res.status}`);
    const home = await get("/");
    const homeHtml = await home.text();
    check("lands on their saved schedule, no details asked again", home.status === 200 && homeHtml.includes("E2E Metformin"));

    const typed = shareCode.toLowerCase().replace(/(...)/, "$1 ");
    const byTyped = await signInWith(typed, "medimantra-test-pw");
    check("code works lowercase and with a space", byTyped.cookie.startsWith(`${patientId}.patient.`), `typed "${typed}"`);

    const wrong = await signInWith(shareCode, "not-the-password");
    check("family code + wrong password rejected", wrong.body.includes("do not match") && !wrong.cookie);

    const unknown = await signInWith("ZZZZZ2", "medimantra-test-pw");
    check("unknown code gets the same message (no account probing)", unknown.body.includes("do not match") && !unknown.cookie);

    const junk = await signInWith("hello!", "medimantra-test-pw");
    check("malformed identifier explained", junk.body.includes("6-letter family code or your patient ID"));

    // The family code is shared on WhatsApp: it must never claim an account.
    jar = new Map();
    const regPage = await get("/login?tab=register");
    const regFields = actionFields(await regPage.text(), 0);
    const regByCode = await postAction("/login", regFields, {
      patientId: shareCode,
      password: "attacker-password",
      confirm: "attacker-password",
    });
    const regBody = await regByCode.text();
    check("family code cannot be used to register", regBody.includes("not the family code") && !jar.has("mm_session"));
  } else {
    console.log("  SKIP  share code was not captured");
  }

  // -----------------------------------------------------------------
  console.log("\n9. Caregiver share-code sign-in");
  if (shareCode) {
    jar = new Map();
    const familyPage = await get("/login?tab=family");
    const familyFields = actionFields(await familyPage.text(), 0);
    const familySignin = await postAction("/login", familyFields, { code: shareCode });
    check("share code accepted", familySignin.status < 400 && jar.has("mm_session"), `status ${familySignin.status}`);
    check("caregiver role in the cookie", (jar.get("mm_session") ?? "").split(".")[1] === "caregiver", (jar.get("mm_session") ?? "").split(".")[1]);

    const carerView = await get("/");
    check("caregiver sees the schedule", (await carerView.text()).includes("E2E Metformin"));
  } else {
    console.log("  SKIP  share code was not captured");
  }

  // -----------------------------------------------------------------
  console.log("\n10. Forged cookie is rejected");
  jar = new Map([["mm_session", `${patientId}.patient.forgedsignature`]]);
  const forged = await get("/");
  check("bad signature is treated as signed out", forged.status === 307 && forged.headers.get("location")?.includes("/onboarding"), `${forged.status} -> ${forged.headers.get("location")}`);
} catch (error) {
  fail += 1;
  console.error("\nUNEXPECTED ERROR:", error.message);
} finally {
  if (admin && created.length) {
    await admin`delete from patients where id in ${admin(created)}`.catch(() => {});
    console.log(`\nCleaned up ${created.length} test patient(s).`);
  }
  await Promise.all([app.end({ timeout: 5 }), admin?.end({ timeout: 5 })]);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}
