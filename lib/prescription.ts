import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { serverEnv } from "@/lib/env";
import { prescriptionResult, type Language, type PrescriptionResult } from "@/lib/schema";

const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  hi: "Hindi, in Devanagari script",
  te: "Telugu, in Telugu script",
};

/**
 * Reads a prescription photo with an OpenAI vision model and returns
 * structured medicines plus safety warnings, in one call.
 *
 * Structured outputs (`zodTextFormat`) make the model fill the exact shape
 * in lib/schema.ts, so the response is parsed and type-checked rather than
 * scraped out of free text.
 */

// Overridable so the model can be swapped without a code change.
const DEFAULT_MODEL = "gpt-5.5";

const INSTRUCTIONS = `
You read medical prescriptions and medicine labels from India for an app used
by elderly patients. Extract every medicine, then check the list for safety
problems. Be exact: a wrong dose time is worse than a blank one.

## Timings
Map every schedule onto three slots: morning, afternoon, night.

Indian dosing shorthand:
- OD / QD / once daily       -> morning
- BD / BID / twice daily     -> morning + night
- TDS / TID / thrice daily   -> morning + afternoon + night
- QID / four times daily     -> morning + afternoon + night (closest fit)
- HS / at bedtime            -> night
- SOS / PRN / as needed      -> all three false (no fixed time)
- STAT / immediately         -> morning

Number patterns are morning-afternoon-night, with or without dashes:
- 1-0-1 or 101 -> morning + night
- 1-1-1 or 111 -> morning + afternoon + night
- 1-0-0 or 100 -> morning
- 0-1-0 or 010 -> afternoon
- 0-0-1 or 001 -> night
- 1-1-0 or 110 -> morning + afternoon
- 0-1-1 or 011 -> afternoon + night
A half (½ or 0.5) in a position still means that slot is taken; put the
amount in "dosage".

## Food
- AC / before food / khali pet / khane se pehle -> before_food
- PC / after food / khane ke baad              -> after_food
- with food / with meals                       -> with_food
- not stated                                   -> anytime

## Duration
"x 5 days", "5d", "x5" -> 5. "1 week" -> 7. "2 weeks" -> 14. "1 month" -> 30.
"continue", "ongoing", "long term", or not stated -> null.

## Names and dosage
- Write the name as printed or written, including brand strength (e.g.
  "Dolo 650", "Telma 40"). Fix obvious handwriting misspellings of real
  medicines, but do not invent a medicine you cannot read.
- "dosage" is the amount per dose: "1 tablet", "½ tablet", "10 ml", "500 mg".
- Set confidence to "low" for any medicine where the name, timing or dose was
  hard to read, so the patient knows to double-check it.

## Warnings
Report, using generic names in the explanation where helpful:
- kind "duplicate": the same active ingredient appears twice, either within
  this prescription or alongside a medicine the patient already takes (for
  example two paracetamol brands such as Dolo and Crocin).
- kind "interaction": a clinically significant drug-drug interaction.

Severity:
- high: dangerous combination; patient should contact their doctor before taking.
- moderate: needs monitoring or timing changes.
- low: minor; worth mentioning to the doctor.

Only report real, well-established problems. Do not pad the list. Each
explanation is ONE short sentence in plain language for an elderly patient.

If the image is not a prescription or medicine label, set is_prescription to
false and return empty lists.
`.trim();

export class PrescriptionReadError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
  }
}

let client: OpenAI | null = null;
const getClient = () => (client ??= new OpenAI({ apiKey: serverEnv().OPENAI_API_KEY }));

export async function readPrescription(
  image: { data: Buffer; mimeType: string },
  existingMedicines: string[],
  language: Language = "en",
): Promise<PrescriptionResult> {
  const model = process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL;
  const dataUrl = `data:${image.mimeType};base64,${image.data.toString("base64")}`;

  const context = existingMedicines.length
    ? `The patient already takes: ${existingMedicines.join(", ")}. Check for duplicates and interactions against these too.`
    : "The patient has no other recorded medicines.";
  // Warnings are read by the patient, so they come in their language.
  // Medicine names and dosages stay exactly as written on the paper.
  const languageNote = `Write every warning explanation in ${LANGUAGE_NAMES[language]}. Keep medicine names, dosages and original_text exactly as written.`;

  const response = await getClient().responses.parse({
    model,
    instructions: INSTRUCTIONS,
    // Reasoning models only; low effort keeps the scan fast while still
    // checking interactions properly.
    ...(/^(gpt-5|o\d)/.test(model) ? { reasoning: { effort: "low" as const } } : {}),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: `${context}\n${languageNote}` },
          // "high" detail: handwriting needs the full resolution.
          { type: "input_image", image_url: dataUrl, detail: "high" },
        ],
      },
    ],
    text: { format: zodTextFormat(prescriptionResult, "prescription") },
  });

  const parsed = response.output_parsed;
  if (!parsed) {
    throw new PrescriptionReadError(
      `Model returned no parsed output (status ${response.status})`,
      "We could not read that prescription. Please try a clearer photo.",
    );
  }

  return parsed;
}
