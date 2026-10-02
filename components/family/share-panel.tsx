"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, MessageCircle } from "lucide-react";
import { useT } from "@/components/i18n-provider";

/**
 * The patient's share link, with copy and WhatsApp buttons.
 *
 * `wa.me/?text=` opens WhatsApp (app or web) with the message filled in and
 * lets the patient pick who to send it to -- nothing is sent without them.
 */
export function SharePanel({
  link,
  shareCode,
  message,
}: {
  link: string;
  shareCode: string;
  message: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden field.
      const field = document.createElement("textarea");
      field.value = link;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(message)}`;

  return (
    <section aria-labelledby="share-heading" className="flex flex-col gap-4">
      <h2 id="share-heading" className="text-2xl font-bold">
        {t.family.shareHeading}
      </h2>
      <p className="text-lg text-ink-muted">{t.family.shareBody}</p>

      <div className="rounded-2xl border-2 border-line bg-surface-muted px-5 py-4">
        <p className="text-base font-semibold text-ink-muted">{t.family.code}</p>
        <p className="font-mono text-4xl tracking-[0.25em]">{shareCode}</p>
        <p className="mt-3 text-base font-semibold text-ink-muted">{t.family.link}</p>
        <p className="font-mono text-lg break-all">{link}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-touch items-center justify-center gap-3 rounded-2xl bg-[#1f7a43] px-6 py-5 text-xl font-bold text-white"
        >
          <MessageCircle aria-hidden="true" className="size-7" />
          {t.family.whatsapp}
        </a>

        <button
          type="button"
          onClick={copy}
          className="flex min-h-touch items-center justify-center gap-3 rounded-2xl border-2 border-accent px-6 py-4 text-xl font-bold text-accent"
        >
          {copied ? (
            <>
              <Check aria-hidden="true" className="size-7" strokeWidth={3} />
              {t.family.copied}
            </>
          ) : (
            <>
              <Copy aria-hidden="true" className="size-7" />
              {t.family.copy}
            </>
          )}
        </button>
      </div>
      <span role="status" className="sr-only">
        {copied ? t.family.copiedSr : ""}
      </span>

      <Link
        href={link.replace(/^https?:\/\/[^/]+/, "")}
        className="flex min-h-touch items-center justify-center gap-2 rounded-2xl px-6 py-3 text-lg font-semibold text-ink-muted underline"
      >
        <ExternalLink aria-hidden="true" className="size-5" />
        {t.family.preview}
      </Link>
    </section>
  );
}
