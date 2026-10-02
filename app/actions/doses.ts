"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { updateDoseStatus, DOSE_STATUSES } from "@/lib/data";

const input = z.object({
  doseId: z.string().uuid(),
  status: z.enum(DOSE_STATUSES),
});

/**
 * Marks a dose taken/skipped. Both patients and caregivers may do this --
 * the dose_logs policy allows either role -- but the dose must belong to the
 * session's patient, which RLS enforces rather than this function.
 */
export async function markDose(formData: FormData): Promise<void> {
  const session = await requireSession();

  const parsed = input.safeParse({
    doseId: formData.get("doseId"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("Invalid dose update.");

  await updateDoseStatus(
    session.patientId,
    parsed.data.doseId,
    parsed.data.status,
    session.role,
  );

  revalidatePath("/");
}
