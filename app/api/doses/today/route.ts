import { getSession } from "@/lib/auth";
import { getTodayDoses } from "@/lib/data";
import type { ReminderDose } from "@/lib/schema";

/**
 * GET /api/doses/today
 *
 * Today's doses for the signed-in patient, for the reminder poller. Like
 * the dashboard, reading this also marks anything >2h overdue as missed, so
 * the poller never reminds about a dose that has already lapsed.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });

  const doses = await getTodayDoses(session.patientId, session.role);

  const body: ReminderDose[] = doses.map((d) => ({
    id: d.id,
    medicine_name: d.medicine_name,
    dosage: d.dosage,
    food_instruction: d.food_instruction,
    slot: d.slot,
    status: d.status,
    due_at: d.due_at.toISOString(),
  }));

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
