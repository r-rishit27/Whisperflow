import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { getSession, type Session } from "@/lib/auth";
import { getPatientById } from "@/lib/data";
import { LANGUAGE_COOKIE, getDictionary } from "@/lib/i18n";
import { LANGUAGES, type Language, type Patient } from "@/lib/schema";

/**
 * Per-request helpers. React's cache() dedupes them within one request, so
 * the layout and the page can both ask for the patient without a second
 * database round trip.
 */

export const getCurrentSession = cache(async (): Promise<Session | null> => getSession());

export const getCurrentPatient = cache(async (): Promise<Patient | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  return getPatientById(session.patientId, session.role);
});

const isLanguage = (v: unknown): v is Language => LANGUAGES.includes(v as Language);

/**
 * The UI language: the signed-in patient's choice, else the language
 * cookie (set at onboarding, sign-in and when it is changed), else English.
 */
export const getLanguage = cache(async (): Promise<Language> => {
  const patient = await getCurrentPatient().catch(() => null);
  if (patient) return patient.language;
  const cookie = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  return isLanguage(cookie) ? cookie : "en";
});

/** Cookie-only variant for loading screens, which must not wait on the DB. */
export async function getLanguageFast(): Promise<Language> {
  const cookie = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  return isLanguage(cookie) ? cookie : "en";
}

export async function getT() {
  return getDictionary(await getLanguage());
}
