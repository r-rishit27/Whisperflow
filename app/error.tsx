"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, LifeBuoy } from "lucide-react";
import { useT } from "@/components/i18n-provider";

/**
 * Friendly error screen for anything that throws while rendering. Says
 * plainly that nothing was lost (the most common worry), offers one big
 * retry, and logs the error for the developer.
 */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 py-12 text-center">
      <LifeBuoy aria-hidden="true" className="size-20 text-accent" strokeWidth={1.5} />
      <h1 className="text-3xl font-bold">{t.states.errorTitle}</h1>
      <p className="text-xl text-ink-muted">{t.states.errorBody}</p>
      <button
        type="button"
        onClick={reset}
        className="flex min-h-touch w-full items-center justify-center gap-3 rounded-2xl bg-accent px-6 py-5 text-2xl font-bold text-accent-ink"
      >
        <RotateCcw aria-hidden="true" className="size-7" />
        {t.common.tryAgain}
      </button>
      <Link href="/" className="min-h-touch py-3 text-lg font-semibold text-accent underline">
        {t.states.goHome}
      </Link>
    </div>
  );
}
