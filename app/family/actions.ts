"use server";

import { revalidatePath } from "next/cache";
import { requireSession, setLanguageCookie } from "@/lib/auth";
import { setPatientLanguage } from "@/lib/data";
import { LANGUAGES, type Language } from "@/lib/schema";

/** Changes the patient's language: the UI, MediMitra and its voice. */
export async function changeLanguage(formData: FormData): Promise<void> {
  const session = await requireSession();
  const language = formData.get("language") as Language;
  if (session.role !== "patient" || !LANGUAGES.includes(language)) return;

  await setPatientLanguage(session.patientId, language);
  await setLanguageCookie(language);
  // Every page's labels change, not just this one.
  revalidatePath("/", "layout");
}
