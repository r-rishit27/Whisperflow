import "server-only";

import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { serverEnv } from "@/lib/env";
import {
  APP_TIME_ZONE,
  EARLY_WINDOW_MINUTES,
  FOOD_LABELS,
  LANGUAGE_LABELS,
  SLOT_LABELS,
  SLOT_TIMES,
  assistantTurn,
  type AssistantTurn,
  type Language,
  type Patient,
  type Slot,
  type TodayDose,
} from "@/lib/schema";

/**
 * MediMitra, the voice assistant: speech in, schedule-grounded answer out,
 * speech back. Each step is its own function so the route can report which
 * one failed.
 */

const STT_MODEL = process.env.OPENAI_STT_MODEL || "gpt-4o-transcribe";
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.5";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "coral";

let client: OpenAI | null = null;
const openai = () => (client ??= new OpenAI({ apiKey: serverEnv().OPENAI_API_KEY }));

// ---------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------

export async function transcribe(
  audio: { data: Buffer; mimeType: string; filename: string },
  language: Language,
  medicineNames: string[],
): Promise<string> {
  const result = await openai().audio.transcriptions.create({
    model: STT_MODEL,
    file: await toFile(audio.data, audio.filename, { type: audio.mimeType }),
    // A hint, not a constraint: code-mixed Hindi-English still transcribes.
    language,
    // Brand names like "Telma" or "Ecosprin" are not dictionary words;
    // priming the model with them fixes most mis-hearings.
    prompt: medicineNames.length
      ? `The speaker is an elderly patient talking about their medicines: ${medicineNames.join(", ")}.`
      : "The speaker is an elderly patient talking about their medicines.",
  });
  return result.text.trim();
}

// ---------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------

const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  hi: "Hindi (Devanagari script)",
  te: "Telugu (Telugu script)",
};

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE,
});

function scheduleContext(doses: TodayDose[], now: Date): string {
  if (doses.length === 0) return "The patient has no medicines scheduled today.";

  const markableBefore = now.getTime() + EARLY_WINDOW_MINUTES * 60_000;
  return doses
    .map((d) => {
      const slot = d.slot as Slot;
      const canMark =
        (d.status === "pending" || d.status === "missed") &&
        d.due_at.getTime() <= markableBefore;
      return [
        `- id=${d.id}`,
        `medicine="${d.medicine_name}"`,
        `dose="${d.dosage}"`,
        `time=${SLOT_LABELS[slot] ?? d.slot} ${SLOT_TIMES[slot] ?? ""}`,
        `food="${FOOD_LABELS[d.food_instruction]}"`,
        `status=${d.status}`,
        `can_mark_taken=${canMark}`,
      ].join(" ");
    })
    .join("\n");
}

function instructions(patient: Patient, now: Date): string {
  const firstName = patient.name.split(" ")[0];
  return `
You are MediMitra, a warm and patient helper inside the MediMantra medicine
app. You are talking, by voice, with ${firstName}, an elderly person.

## How you speak
- Always reply in ${LANGUAGE_NAMES[patient.language]}, even if they speak
  another language or mix languages.
- Warm, kind, and simple. One to three short sentences. No lists, no
  markdown, no emoji -- your words are read aloud.
- Use everyday words. Say times the way people say them ("at 9 at night").

## What you may talk about
Only ${firstName}'s medicine schedule for today, below: what to take, when,
how much, and whether to take it with food. You can also confirm what they
have already taken.

## What you must never do
- Never give new medical advice. Never suggest starting, stopping, skipping,
  doubling or changing any medicine or dose, and never diagnose.
- Never invent a medicine, dose or time that is not in the schedule.
- If they ask anything medical beyond the schedule, or describe feeling
  unwell, kindly tell them to ask their doctor${
    patient.caregiver_name ? ` or ${patient.caregiver_name}` : ""
  }. If it sounds urgent (chest pain, trouble breathing, fainting, a fall),
  tell them to call for help or an ambulance right away.

## Marking doses taken
When they clearly say they have taken a medicine, put the matching dose ids
in taken_dose_ids and confirm warmly in your reply.
- Only use ids from the schedule whose can_mark_taken=true.
- Match by medicine name, or by time ("my morning tablets" = every
  can_mark_taken dose in the morning slot).
- If they say they took something you cannot match, or a dose that is not
  due yet (can_mark_taken=false), do not mark it; say so gently.
- If it is unclear whether they took it, or which one, ask rather than guess.
- Questions ("did I take...?", "should I take...?") never mark anything.

## Now
It is ${timeFormat.format(now)} in India.

## ${firstName}'s schedule today
`.trim();
}

export async function converse(
  patient: Patient,
  doses: TodayDose[],
  transcript: string,
): Promise<AssistantTurn> {
  const now = new Date();
  const response = await openai().responses.parse({
    model: CHAT_MODEL,
    ...(/^(gpt-5|o\d)/.test(CHAT_MODEL) ? { reasoning: { effort: "low" as const } } : {}),
    instructions: `${instructions(patient, now)}\n${scheduleContext(doses, now)}`,
    input: [{ role: "user", content: transcript }],
    text: { format: zodTextFormat(assistantTurn, "assistant_turn") },
  });

  const parsed = response.output_parsed;
  if (!parsed) throw new Error(`Chat model returned no parsed output (${response.status})`);
  return parsed;
}

// ---------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------

export async function speak(text: string, language: Language): Promise<Buffer> {
  const response = await openai().audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
    instructions: `Speak in ${LANGUAGE_LABELS[language]} (${LANGUAGE_NAMES[language]}). You are talking to an elderly person: warm, calm and reassuring, a little slower than usual, every word clear. Never rushed.`,
    response_format: "mp3",
  });
  return Buffer.from(await response.arrayBuffer());
}
