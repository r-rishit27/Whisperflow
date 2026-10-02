/**
 * Translation check: every screen renders in the patient's language, with
 * no English labels leaking through, and switching language takes effect
 * everywhere.
 *
 *   npm run dev
 *   node --env-file=.env scripts/verify-i18n.mjs [--base http://localhost:3000]
 *
 * Missing dictionary keys are already impossible (TypeScript); this checks
 * the wiring -- that each screen actually uses the dictionary.
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

/** Visible text only: no tags, scripts, styles or attribute values. */
async function textOf(path, cookie) {
  const res = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
  return { status: res.status, html, text };
}

// English UI words that must not appear on a Hindi/Telugu screen. Medicine
// names, "MediMantra", "WhatsApp" and "MediMitra" are allowed.
const ENGLISH_UI = /\b(Today|Scan|Voice|Family|Morning|Afternoon|Night|Taken|Skip|Missed|Undo|After food|Before food|Good (morning|afternoon|evening)|Share on|Copy link|Settings|Sign out|Last 7 days|Coming up|still to take|Take a photo|Upload a photo|Tap to talk)\b/;

const DEVANAGARI = /[ऀ-ॿ]/;
const TELUGU = /[ఀ-౿]/;
const created = [];

async function makePatient(name, language) {
  const code = Array.from({ length: 6 }, () => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 32)]).join("");
  const [p] = await app`select * from app.create_patient(${name}, ${language}, 'Ravi', null, ${code})`;
  created.push(p.id);
  await admin`
    insert into medicines (patient_id, name, dosage, time_slots, food_instruction, created_at)
    values (${p.id}, 'Dolo 650', '1 tablet', '{morning,night}'::text[], 'after_food', now() - interval '2 days')`;
  return p;
}

try {
  console.log(`\nTesting ${base}`);

  for (const [language, script, name, samples] of [
    ["hi", DEVANAGARI, "Kamala Devi", ["आज", "स्कैन", "परिवार", "खाने के बाद", "रात"]],
    ["te", TELUGU, "Venkat Reddy", ["ఈరోజు", "స్కాన్", "కుటుంబం", "భోజనం తర్వాత", "రాత్రి"]],
  ]) {
    console.log(`\n${language === "hi" ? "Hindi" : "Telugu"} patient`);
    const p = await makePatient(name, language);
    const cookie = cookieFor(p.id, "patient");

    const today = await textOf("/", cookie);
    check("<html lang> matches", today.html.includes(`<html lang="${language}"`));
    check("Today screen in the patient's script", script.test(today.text));
    check("nav, food and slot labels translated", samples.every((s) => today.text.includes(s)), samples.join(" · "));
    check("greeting uses a respectful suffix", today.text.includes(language === "hi" ? "Kamala जी" : "Venkat గారు"));
    const leak = ENGLISH_UI.exec(today.text);
    check("no English UI words on Today", !leak, leak?.[0]);

    for (const path of ["/scan", "/voice", "/family"]) {
      const page = await textOf(path, cookie);
      const leaked = ENGLISH_UI.exec(page.text);
      check(`${path} translated, no English labels`, page.status === 200 && script.test(page.text) && !leaked, leaked?.[0]);
    }

    const pub = await textOf(`/family/${p.share_code}`);
    check("public family page in the patient's language", script.test(pub.text) && !ENGLISH_UI.exec(pub.text), ENGLISH_UI.exec(pub.text)?.[0]);
  }

  // -----------------------------------------------------------------
  console.log("\nSwitching language");
  const p = await makePatient("Asha Rao", "en");
  const cookie = cookieFor(p.id, "patient");
  check("starts in English", (await textOf("/", cookie)).text.includes("Good "));

  // The language buttons are no-JS forms posting changeLanguage.
  const family = await textOf("/family", cookie);
  const forms = [...family.html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);
  const hindiForm = forms.find((f) => f.includes('name="language" value="hi"'));
  const body = new FormData();
  for (const m of hindiForm.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const n = /name="([^"]+)"/.exec(m[0])?.[1];
    const v = (/value="([^"]*)"/.exec(m[0])?.[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    if (n) body.append(n, v);
  }
  const res = await fetch(`${base}/family`, { method: "POST", body, headers: { cookie }, redirect: "manual" });
  check("language form accepted", res.status < 400, `${res.status}`);
  check("language cookie set", (res.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("mm_lang=hi")));

  const [row] = await admin`select language from patients where id = ${p.id}`;
  check("saved to Supabase", row.language === "hi", row.language);
  const after = await textOf("/", cookie);
  check("every screen now in Hindi", DEVANAGARI.test(after.text) && after.html.includes('<html lang="hi"'));

  // -----------------------------------------------------------------
  console.log("\nSigned-out screens follow the language cookie");
  const login = await textOf("/login", "mm_lang=te");
  check("login in Telugu from the cookie", TELUGU.test(login.text) && login.html.includes('<html lang="te"'));
  const onboarding = await textOf("/onboarding", "mm_lang=hi");
  check("onboarding in Hindi from the cookie", onboarding.text.includes("आपका नाम क्या है?"));
  const notFound = await textOf("/family/ZZZZZ2", "mm_lang=te");
  check("friendly not-found, translated", notFound.html.includes("ఆ పేజీ కనిపించలేదు"));
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
