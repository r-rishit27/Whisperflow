/**
 * Large circular progress for doses taken today. Plain SVG, so it renders
 * on the server with no chart library and no client JavaScript.
 */
export function ProgressRing({
  taken,
  total,
  label,
  takenWord,
}: {
  taken: number;
  total: number;
  /** Full sentence for screen readers, e.g. "3 of 5 doses taken today". */
  label: string;
  /** The word under the number, e.g. "taken". */
  takenWord: string;
}) {
  const size = 184;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total === 0 ? 0 : taken / total;
  const done = total > 0 && taken === total;

  return (
    <div role="img" aria-label={label} className="relative mx-auto size-[184px] shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-teal-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={`transition-[stroke-dashoffset] duration-700 ${done ? "stroke-success" : "stroke-accent"}`}
        />
      </svg>
      <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-bold">
          {taken}
          <span className="text-3xl text-ink-muted">/{total}</span>
        </span>
        <span className="text-lg font-semibold text-ink-muted">{takenWord}</span>
      </div>
    </div>
  );
}
