/**
 * Placeholder blocks shown while a screen loads. Shaped like the real
 * content so nothing jumps when it arrives; the pulse respects
 * reduced-motion. A visible, translated "Loading…" line is included because
 * grey boxes alone can read as broken to someone unfamiliar with apps.
 */
export function SkeletonBlock({ className }: { className: string }) {
  return <div aria-hidden="true" className={`rounded-2xl bg-surface-muted motion-safe:animate-pulse ${className}`} />;
}

export function LoadingScreen({ label, variant = "list" }: { label: string; variant?: "list" | "dashboard" }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-5 w-40" />
        <SkeletonBlock className="h-10 w-72 max-w-full" />
      </div>
      <p className="flex items-center gap-3 text-lg text-ink-muted">
        <span aria-hidden="true" className="size-3 rounded-full bg-accent motion-safe:animate-ping" />
        {label}
      </p>

      {variant === "dashboard" ? (
        <div className="lg:grid lg:grid-cols-[22rem_1fr] lg:gap-10">
          <SkeletonBlock className="mb-6 h-72 lg:mb-0" />
          <div className="flex flex-col gap-4">
            <SkeletonBlock className="h-8 w-48" />
            <SkeletonBlock className="h-40" />
            <SkeletonBlock className="h-40" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <SkeletonBlock className="h-36" />
          <SkeletonBlock className="h-36" />
          <SkeletonBlock className="h-20" />
        </div>
      )}
    </div>
  );
}
