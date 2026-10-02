"use server";

import { redirect } from "next/navigation";
import { createPatient, patientInput } from "@/lib/data";
import { createSession, setLanguageCookie } from "@/lib/auth";
import type { Dictionary } from "@/lib/i18n";

export type OnboardingErrorKey = keyof Dictionary["onboarding"]["errors"];
export type OnboardingState = { error?: OnboardingErrorKey } | undefined;

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = patientInput.safeParse({
    name: formData.get("name"),
    language: formData.get("language"),
    caregiverName: formData.get("caregiverName") ?? "",
    caregiverPhone: formData.get("caregiverPhone") ?? "",
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "name" ? "name" : field === "caregiverPhone" ? "phone" : "generic" };
  }

  const patient = await createPatient(parsed.data);

  // Store the patient's id in the signed session cookie, which is also what
  // identifies them to the RLS policies on every later query.
  await createSession({ patientId: patient.id, role: "patient" });
  await setLanguageCookie(patient.language);

  // redirect() throws, so it must sit outside any try/catch.
  redirect("/welcome");
}
