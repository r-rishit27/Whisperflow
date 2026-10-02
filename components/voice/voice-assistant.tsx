"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Loader2, Volume2, CheckCircle2 } from "lucide-react";
import type { VoiceResponse } from "@/lib/schema";
import { useT } from "@/components/i18n-provider";

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; audio: string | null; marked: VoiceResponse["marked"] };

type Phase = "idle" | "recording" | "thinking" | "speaking";

// Long enough for a question, short enough that a forgotten tap does not
// record the whole room.
const MAX_RECORDING_MS = 30_000;

// Safari records mp4; Chrome and Firefox record webm/opus.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

/** 0.1s of silence, played inside the tap gesture to unlock autoplay (iOS). */
function silentWav(): string {
  const samples = 800;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  let binary = "";
  new Uint8Array(buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(binary)}`;
}

let nextId = 0;

export function VoiceAssistant({ firstName }: { firstName: string }) {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const player = useRef<HTMLAudioElement | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, phase]);

  // Release the microphone if the patient navigates away mid-recording.
  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      if (stopTimer.current) clearTimeout(stopTimer.current);
    },
    [],
  );

  // A seconds counter while recording, so it is obvious the mic is live.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  function unlockAudio() {
    // Must run synchronously inside the tap, or iOS blocks the reply later.
    const audio = (player.current ??= new Audio());
    audio.src = silentWav();
    audio.play().catch(() => {});
  }

  function play(base64: string) {
    const audio = (player.current ??= new Audio());
    audio.src = `data:audio/mpeg;base64,${base64}`;
    audio.onended = () => setPhase("idle");
    setPhase("speaking");
    audio.play().catch(() => setPhase("idle"));
  }

  async function start() {
    setError(null);
    unlockAudio();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t.voice.micDenied);
      return;
    }

    const mimeType = MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void send(new Blob(chunks.current, { type: rec.mimeType }));
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setPhase("recording");
    stopTimer.current = setTimeout(stop, MAX_RECORDING_MS);
  }

  function stop() {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    unlockAudio();
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      setPhase("thinking");
    }
  }

  async function send(blob: Blob) {
    if (blob.size < 1000) {
      setPhase("idle");
      setError(t.voice.tooShort);
      return;
    }

    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", blob, `speech.${ext}`);
      const res = await fetch("/api/voice", { method: "POST", body: form });
      const json = await res.json();
      // Server messages are English; the patient sees their own language.
      if (!res.ok) throw new Error(t.voice.failed);

      const reply = json as VoiceResponse;
      setMessages((all) => [
        ...all,
        ...(reply.transcript ? [{ id: nextId++, role: "user" as const, text: reply.transcript }] : []),
        { id: nextId++, role: "assistant" as const, text: reply.reply, audio: reply.audio, marked: reply.marked },
      ]);

      // Doses changed: refresh the server-rendered Today screen's data.
      if (reply.marked.length > 0) router.refresh();

      if (reply.audio) play(reply.audio);
      else setPhase("idle");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : t.voice.failed);
    }
  }

  const busy = phase === "thinking";
  const recording = phase === "recording";

  return (
    <div className="flex flex-col gap-6">
      {/* Conversation */}
      <div aria-live="polite" className="flex flex-col gap-4">
        {messages.length === 0 ? (
          <div className="rounded-2xl bg-surface-muted px-5 py-5 text-lg">
            <p className="text-xl font-bold">{t.voice.intro(firstName)}</p>
            <p className="mt-2 text-ink-muted">{t.voice.introHint}</p>
            <ul className="mt-2 flex flex-col gap-1 text-ink">
              {t.voice.examples.map((example) => (
                <li key={example}>&ldquo;{example}&rdquo;</li>
              ))}
            </ul>
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === "user" ? (
            <p
              key={m.id}
              className="ml-10 self-end rounded-3xl rounded-br-md bg-accent px-5 py-4 text-xl text-accent-ink"
            >
              {m.text}
            </p>
          ) : (
            <div
              key={m.id}
              className="mr-6 self-start rounded-3xl rounded-bl-md border-2 border-line bg-surface-muted px-5 py-4"
            >
              <p className="text-xl leading-relaxed">{m.text}</p>
              {m.marked.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {m.marked.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-base font-semibold text-success"
                    >
                      <CheckCircle2 aria-hidden="true" className="size-5" />
                      {t.voice.marked(d.medicine_name)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {m.audio ? (
                <button
                  type="button"
                  onClick={() => play(m.audio!)}
                  className="mt-2 flex min-h-touch items-center gap-2 text-base font-semibold text-accent"
                >
                  <Volume2 aria-hidden="true" className="size-6" />
                  {t.voice.playAgain}
                </button>
              ) : null}
            </div>
          ),
        )}

        {busy ? (
          <p className="mr-6 flex items-center gap-3 self-start rounded-3xl rounded-bl-md bg-surface-muted px-5 py-4 text-xl text-ink-muted">
            <Loader2 aria-hidden="true" className="size-6 animate-spin" />
            {t.voice.thinking}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl border-2 border-danger bg-danger-soft px-5 py-4 text-lg font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {/* The microphone. Sticky above the tab bar so it is always in reach. */}
      <div className="sticky bottom-[calc(var(--spacing-nav)+1rem)] flex flex-col items-center gap-3 bg-gradient-to-t from-surface from-70% to-transparent pt-6 lg:bottom-6">
        <div className={`relative ${recording ? "text-danger" : "text-accent"}`}>
          {recording ? (
            <>
              <span className="mic-ring" aria-hidden="true" />
              <span className="mic-ring delay" aria-hidden="true" />
            </>
          ) : null}
          <button
            type="button"
            onClick={recording ? stop : start}
            disabled={busy || phase === "speaking"}
            aria-label={recording ? t.voice.stop : t.voice.talk}
            className={`relative flex size-44 items-center justify-center rounded-full shadow-xl disabled:opacity-60 ${
              recording ? "bg-danger text-surface" : "bg-accent text-accent-ink"
            } ${phase === "idle" ? "mic-idle" : ""}`}
          >
            {recording ? (
              <Square aria-hidden="true" className="size-16" fill="currentColor" />
            ) : busy ? (
              <Loader2 aria-hidden="true" className="size-20 animate-spin" />
            ) : (
              <Mic aria-hidden="true" className="size-24" strokeWidth={1.75} />
            )}
          </button>
        </div>

        <p className="text-xl font-bold" aria-live="polite">
          {recording
            ? t.voice.listening(seconds)
            : busy
              ? t.voice.thinkingShort
              : phase === "speaking"
                ? t.voice.speaking
                : t.voice.tapToTalk}
        </p>
      </div>

      {/* Scroll target sits below the sticky microphone: scrolling to it
          leaves the mic in its natural spot under the newest bubble,
          instead of pinned on top of it. */}
      <div ref={bottom} aria-hidden="true" />
    </div>
  );
}
