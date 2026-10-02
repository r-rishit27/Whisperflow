import { getSession } from "@/lib/auth";
import { getMedicines, getPatientById } from "@/lib/data";
import { readPrescription, PrescriptionReadError } from "@/lib/prescription";

/**
 * POST /api/parse
 *
 * Body: multipart/form-data with one `image` field.
 * Returns: PrescriptionResult (lib/schema.ts) -- medicines and warnings.
 *
 * Nothing is saved here. The scan screen shows the result as editable cards
 * and only writes to the database once the patient confirms.
 */

// Vision + reasoning can take a while on a dense handwritten prescription.
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// `code` is a key into scan.errors (lib/i18n.ts), so the scan screen can
// show the message in the patient's language; `error` is the English
// fallback for other API clients.
const error = (status: number, code: string, message: string) =>
  Response.json({ error: message, code }, { status });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return error(401, "signIn", "Please sign in first.");

  // Matches the medicines_write RLS policy: family can view, not prescribe.
  if (session.role !== "patient") {
    return error(403, "patientOnly", "Only the patient can add medicines.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error(400, "noFile", "Please upload a photo of the prescription.");
  }

  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return error(400, "noFile", "Please upload a photo of the prescription.");
  }
  if (file.size > MAX_BYTES) {
    return error(413, "tooLarge", "That photo is too large. Please use one under 10 MB.");
  }
  if (!ACCEPTED_TYPES.has(file.type)) {
    return error(415, "badType", "Please upload a JPEG, PNG or WebP photo.");
  }

  try {
    const [existing, patient] = await Promise.all([
      getMedicines(session.patientId, session.role),
      getPatientById(session.patientId, session.role),
    ]);
    const result = await readPrescription(
      { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type },
      existing.map((m) => m.name),
      patient?.language ?? "en",
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof PrescriptionReadError) {
      console.error("[api/parse]", err.message);
      return error(422, "unreadable", err.userMessage);
    }
    console.error("[api/parse] unexpected", err);
    return error(502, "failed", "Reading the prescription failed. Please try again.");
  }
}
