import { getLanguageFast } from "@/lib/current";
import { getDictionary } from "@/lib/i18n";
import { SkeletonBlock } from "@/components/skeleton";

export default async function Loading() {
  const t = getDictionary(await getLanguageFast());
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <SkeletonBlock className="h-10 w-72 max-w-full" />
      <p className="text-lg text-ink-muted">{t.common.loading}</p>
      <div className="lg:grid lg:grid-cols-[1fr_24rem] lg:gap-10">
        <div className="flex flex-col gap-6">
          <SkeletonBlock className="h-36" />
          <SkeletonBlock className="h-72" />
        </div>
        <div className="mt-6 flex flex-col gap-3 lg:mt-0">
          <SkeletonBlock className="h-20" />
          <SkeletonBlock className="h-20" />
          <SkeletonBlock className="h-20" />
        </div>
      </div>
    </div>
  );
}
