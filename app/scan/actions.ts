"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { saveScannedMedicines } from "@/lib/data";
import { scannedMedicinesInput } from "@/lib/schema";

import type { Dictionary } from "@/lib/i18n";

/** `error` is a key into scan.errors, shown translated on the client. */
export type SaveScanResult = { error: keyof Dictionary["scan"]["errors"] } | undefined;

/**
 * Saves the medicines the patient confirmed on the scan screen, creates the
 * next 7 days of dose rows, and sends them to the dashboard.
 */
export async function saveScan(medicines: unknown): Promise<SaveScanResult> {
  const session = await getSession();
  if (!session) return { error: "signIn" };
  if (session.role !== "patient") return { error: "patientOnly" };

  const parsed = scannedMedicinesInput.safeParse(medicines);
  if (!parsed.success) {
    return { error: "atLeastOne" };
  }

  let saved: { medicines: number; doses: number };
  try {
    saved = await saveScannedMedicines(session.patientId, parsed.data);
  } catch (error) {
    console.error("[saveScan]", error);
    return { error: "saveFailed" };
  }

  revalidatePath("/");
  // redirect() throws, so it sits outside the try/catch above.
  redirect(`/?added=${saved.medicines}`);
}
