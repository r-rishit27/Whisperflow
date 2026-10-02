/**
 * A soft two-note chime, synthesised with Web Audio so there is no sound
 * file to load. Sine tones with slow attack and long release: gentle
 * rather than alarming, but distinct enough to notice.
 *
 * Browsers only allow audio after a user gesture, so call `unlockChime()`
 * from a tap (the reminders banner and the first touch anywhere both do).
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  return (context ??= new Ctor());
}

export function unlockChime(): void {
  const ctx = getContext();
  if (ctx?.state === "suspended") void ctx.resume();
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;

  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.22, start + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Plays the chime `times` times, a couple of seconds apart. */
export function playChime(times = 2): void {
  const ctx = getContext();
  if (!ctx) return;
  void ctx.resume().then(() => {
    for (let i = 0; i < times; i += 1) {
      const t = ctx.currentTime + i * 2.2;
      tone(ctx, 659.25, t, 1.4); // E5
      tone(ctx, 880, t + 0.32, 1.6); // A5
    }
  });
}
