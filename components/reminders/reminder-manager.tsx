"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BellRing, Check, Clock, Loader2, X } from "lucide-react";
import { markDose } from "@/app/actions/doses";
import { playChime, unlockChime } from "@/components/reminders/chime";
import { MISSED_AFTER_HOURS, type ReminderDose, type Slot } from "@/lib/schema";
import { useLanguage, useT } from "@/components/i18n-provider";

/**
 * Dose reminders while the app is open.
 *
 * Every minute it fetches today's doses and, when a slot comes due, plays a
 * chime, shows a browser notification, and opens a full-screen reminder
 * with a big Taken button. Reminding only works while a MediMantra tab is
 * open: reaching a closed browser needs Web Push and a service worker,
 * which this does not do.
 */

const CHECK_EVERY_MS = 60_000;
const SNOOZE_MS = 10 * 60_000;
const LAPSE_MS = MISSED_AFTER_HOURS * 60 * 60_000;

// localStorage can throw (private mode, blocked storage); never let a
// reminder fail because of it.
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

const PROMPT_DISMISSED = "mm_reminder_prompt_dismissed";
const REMINDED = "mm_reminded"; // JSON: { [doseId]: epoch ms it may next fire }

// Browser-only values, read through useSyncExternalStore so the server
// render (prompt hidden) and the client render can differ without a
// hydration mismatch.
const noSubscription = () => () => {};
const readPermission = (): NotificationPermission | "unsupported" =>
  "Notification" in window ? Notification.permission : "unsupported";
const readDismissed = () => store.get(PROMPT_DISMISSED) === "1";

function loadReminded(): Record<string, number> {
  try {
    return JSON.parse(store.get(REMINDED) ?? "{}");
  } catch {
    return {};
  }
}

export function ReminderManager() {
  const t = useT();
  const language = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const browserPermission = useSyncExternalStore(noSubscription, readPermission, () => "unsupported" as const);
  const storedDismissal = useSyncExternalStore(noSubscription, readDismissed, () => true);
  // Set from the banner's buttons, which take precedence once used.
  const [askedPermission, setAskedPermission] = useState<NotificationPermission | "unsupported" | null>(null);
  const [dismissedNow, setDismissedNow] = useState(false);
  const permission = askedPermission ?? browserPermission;
  const promptHidden = storedDismissal || dismissedNow;
  const [active, setActive] = useState<ReminderDose[] | null>(null);
  const [saving, setSaving] = useState(false);
  const takeButton = useRef<HTMLButtonElement>(null);
  // Lets the minute timer see the open reminder without re-subscribing.
  const activeRef = useRef<ReminderDose[] | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    // Any first touch unlocks audio, so the chime can play later.
    const unlock = () => unlockChime();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const fire = useCallback((doses: ReminderDose[]) => {
    setActive(doses);
    playChime();

    if ("Notification" in window && Notification.permission === "granted") {
      const slot = doses[0].slot as Slot;
      const n = new Notification(t.reminders.notification(t.slots[slot] ?? ""), {
        body: doses.map((d) => `${d.medicine_name} — ${d.dosage}`).join("\n"),
        tag: `mm-${doses[0].due_at}`, // one notification per slot, not per medicine
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  }, [t]);

  const check = useCallback(async () => {
    // Do not stack reminders on top of an open one.
    if (activeRef.current) return;

    let doses: ReminderDose[];
    try {
      const res = await fetch("/api/doses/today", { cache: "no-store" });
      if (!res.ok) return;
      doses = await res.json();
    } catch {
      return; // offline: try again next minute
    }

    const now = Date.now();
    const reminded = loadReminded();

    const due = doses.filter((d) => {
      const at = new Date(d.due_at).getTime();
      return (
        d.status === "pending" &&
        at <= now &&
        now - at < LAPSE_MS &&
        (reminded[d.id] ?? 0) <= now
      );
    });
    if (due.length === 0) return;

    // Remind for the earliest due slot; a later one will follow.
    const first = due[0].due_at;
    const group = due.filter((d) => d.due_at === first);

    // Recorded before showing, so a reload does not repeat it.
    for (const d of group) reminded[d.id] = Number.MAX_SAFE_INTEGER;
    store.set(REMINDED, JSON.stringify(reminded));
    fire(group);
  }, [fire]);

  useEffect(() => {
    // check() only sets state after an awaited fetch, never synchronously,
    // so this cannot cascade renders; the rule cannot see through the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    // Phones throttle background timers; catch up when the tab comes back.
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  useEffect(() => {
    if (active) takeButton.current?.focus();
  }, [active]);

  async function enable() {
    unlockChime();
    if (!("Notification" in window)) {
      setAskedPermission("unsupported");
      return;
    }
    setAskedPermission(await Notification.requestPermission());
  }

  function dismissPrompt() {
    store.set(PROMPT_DISMISSED, "1");
    setDismissedNow(true);
  }

  async function takeAll() {
    if (!active) return;
    setSaving(true);
    try {
      for (const d of active) {
        const form = new FormData();
        form.set("doseId", d.id);
        form.set("status", "taken");
        await markDose(form);
      }
      setActive(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function snooze() {
    if (!active) return;
    const reminded = loadReminded();
    for (const d of active) reminded[d.id] = Date.now() + SNOOZE_MS;
    store.set(REMINDED, JSON.stringify(reminded));
    setActive(null);
  }

  // Not on the public family page: that screen is for family members, even
  // when the patient opens it to preview what they see.
  const isFamilyPage = /^\/family\/[^/]+/.test(pathname);
  const showPrompt = !promptHidden && permission === "default" && !isFamilyPage;

  return (
    <>
      {showPrompt ? (
        <div className="mx-auto mb-6 w-full max-w-2xl">
          <section
            aria-labelledby="reminder-prompt"
            className="rounded-2xl border-2 border-accent bg-teal-50 px-5 py-5"
          >
            <h2 id="reminder-prompt" className="flex items-center gap-3 text-xl font-bold text-accent">
              <Bell aria-hidden="true" className="size-7" />
              {t.reminders.promptTitle}
            </h2>
            <p className="mt-2 text-lg text-ink">
              {t.reminders.promptBody}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={enable}
                className="flex-1 rounded-xl bg-accent px-5 py-3 text-xl font-bold text-accent-ink"
              >
                {t.reminders.yes}
              </button>
              <button
                type="button"
                onClick={dismissPrompt}
                className="rounded-xl px-5 py-3 text-lg font-semibold text-ink-muted"
              >
                {t.reminders.notNow}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {active ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="reminder-title"
          aria-describedby="reminder-list"
          className="fixed inset-0 z-[60] flex flex-col bg-surface"
        >
          <div className="mx-auto flex w-full max-w-screen-sm flex-1 flex-col overflow-y-auto px-6 pt-10 pb-6">
            <BellRing aria-hidden="true" className="mx-auto size-24 text-accent motion-safe:animate-bounce" />
            <h2 id="reminder-title" className="mt-4 text-center text-4xl font-bold">
              {t.reminders.title}
            </h2>
            <p className="mt-2 text-center text-2xl text-ink-muted">
              {language === "en"
                ? `${t.slots[active[0].slot as Slot]} · ${t.slotTimes[active[0].slot as Slot]}`
                : t.slotTimes[active[0].slot as Slot]}
            </p>

            <ul id="reminder-list" className="mt-8 flex flex-col gap-3">
              {active.map((d) => (
                <li key={d.id} className="rounded-2xl border-2 border-line bg-surface-muted px-5 py-4">
                  <p className="text-2xl font-bold">{d.medicine_name}</p>
                  <p className="text-xl text-ink-muted">
                    {d.dosage} · {t.food[d.food_instruction]}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="mx-auto flex w-full max-w-screen-sm flex-col gap-3 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <button
              ref={takeButton}
              type="button"
              onClick={takeAll}
              disabled={saving}
              className="flex min-h-[5.5rem] items-center justify-center gap-3 rounded-3xl bg-success px-6 text-3xl font-bold text-surface disabled:opacity-70"
            >
              {saving ? (
                <Loader2 aria-hidden="true" className="size-10 animate-spin" />
              ) : (
                <Check aria-hidden="true" className="size-10" strokeWidth={3} />
              )}
              {active.length > 1 ? t.reminders.tookThem : t.today.takenButton}
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={snooze}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-line px-4 py-4 text-xl font-semibold text-ink"
              >
                <Clock aria-hidden="true" className="size-6" />
                {t.reminders.later}
              </button>
              <button
                type="button"
                onClick={() => setActive(null)}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-line px-5 py-4 text-xl font-semibold text-ink-muted"
              >
                <X aria-hidden="true" className="size-6" />
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
