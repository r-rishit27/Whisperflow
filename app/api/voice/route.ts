import { getSession } from "@/lib/auth";
import { getPatientById, getTodayDoses, markDosesTaken } from "@/lib/data";
import { transcribe, converse, speak } from "@/lib/assistant";
import type { Language, VoiceResponse } from "@/lib/schema";

/**
 * POST /api/voice
 *
 * Body: multipart/form-data with one `audio` field (a recording).
 * Returns: VoiceResponse -- transcript, reply text, reply audio (base64
 * MP3) and any doses marked taken.
 *
 * The patient is identified by the signed session cookie, never by an id in
 * the request: a client-supplied id would let anyone read or mark another
 * patient's doses.
 */

export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fixed replies, so failures still answer in the patient's language. */
const FALLBACKS: Record<"unheard" | "notRecorded", Record<Language, string>> = {
  unheard: {
    en: "Sorry, I didn't catch that. Please tap the microphone and try again.",
    hi: "माफ़ कीजिए, मैं सुन नहीं पाई। कृपया माइक दबाकर फिर से बोलिए।",
    te: "క్షమించండి, నాకు వినిపించలేదు. దయచేసి మైక్ నొక్కి మళ్ళీ చెప్పండి.",
  },
  notRecorded: {
    en: "I couldn't record that dose. Please tap Taken on the Today screen.",
    hi: "मैं वह खुराक दर्ज नहीं कर पाई। कृपया Today स्क्रीन पर Taken दबाइए।",
    te: "నేను ఆ మోతాదును నమోదు చేయలేకపోయాను. దయచేసి Today స్క్రీన్‌లో Taken నొక్కండి.",
  },
};

const error = (status: number, message: string) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return error(401, "Please sign in first.");
  if (session.role !== "patient") {
    return error(403, "The voice assistant is for the patient's own phone.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error(400, "No recording received.");
  }

  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) return error(400, "No recording received.");
  if (file.size > MAX_BYTES) return error(413, "That recording is too long.");

  // MediaRecorder reports e.g. "audio/webm;codecs=opus".
  const mimeType = file.type.split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.has(mimeType)) return error(415, "Unsupported recording format.");

  const [patient, doses] = await Promise.all([
    getPatientById(session.patientId, session.role),
    getTodayDoses(session.patientId, session.role),
  ]);
  if (!patient) return error(401, "Please sign in again.");

  const respond = async (body: Omit<VoiceResponse, "audio">) => {
    let audio: string | null = null;
    try {
      audio = (await speak(body.reply, patient.language)).toString("base64");
    } catch (err) {
      // The text reply still shows; losing the voice is not worth failing on.
      console.error("[api/voice] tts", err);
    }
    return Response.json({ ...body, audio } satisfies VoiceResponse);
  };

  // 1. Speech to text.
  let transcript: string;
  try {
    transcript = await transcribe(
      {
        data: Buffer.from(await file.arrayBuffer()),
        mimeType,
        filename: `speech.${EXTENSIONS[mimeType]}`,
      },
      patient.language,
      [...new Set(doses.map((d) => d.medicine_name))],
    );
  } catch (err) {
    console.error("[api/voice] stt", err);
    return error(502, "Listening failed. Please try again.");
  }

  if (!transcript) {
    return respond({ transcript: "", reply: FALLBACKS.unheard[patient.language], marked: [] });
  }

  // 2. The conversation.
  let turn;
  try {
    turn = await converse(patient, doses, transcript);
  } catch (err) {
    console.error("[api/voice] chat", err);
    return error(502, "MediMitra could not answer. Please try again.");
  }

  // 3. Mark doses. The model only proposes; markDosesTaken re-checks every
  //    id against today's due, unfinished doses for this patient.
  const proposed = turn.taken_dose_ids.filter((id) => UUID.test(id));
  const marked = await markDosesTaken(session.patientId, proposed, session.role);

  // The reply said "done" but nothing was recorded: do not let it stand.
  const reply =
    proposed.length > 0 && marked.length === 0
      ? FALLBACKS.notRecorded[patient.language]
      : turn.reply;

  // 4. Text to speech.
  return respond({ transcript, reply, marked });
}
