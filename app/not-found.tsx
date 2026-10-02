import Link from "next/link";
import { SearchX } from "lucide-react";
import { getT } from "@/lib/current";

// Also what a wrong family share code lands on, hence the hint about codes.
export default async function NotFound() {
  const t = await getT();
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 py-12 text-center">
      <SearchX aria-hidden="true" className="size-20 text-accent" strokeWidth={1.5} />
      <h1 className="text-3xl font-bold">{t.states.notFoundTitle}</h1>
      <p className="text-xl text-ink-muted">{t.states.notFoundBody}</p>
      <Link
        href="/"
        className="flex min-h-touch w-full items-center justify-center rounded-2xl bg-accent px-6 py-5 text-2xl font-bold text-accent-ink"
      >
        {t.states.goHome}
      </Link>
    </div>
  );
}
