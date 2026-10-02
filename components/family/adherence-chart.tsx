"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type TooltipContentProps,
} from "recharts";
import { AlertCircle, Check, Clock, Minus } from "lucide-react";
import type { DayAdherence } from "@/lib/schema";
import { LOCALES, type Dictionary } from "@/lib/i18n";
import { useLanguage, useT } from "@/components/i18n-provider";

/**
 * 7-day adherence as stacked columns, one per day.
 *
 * Colours are status tokens from globals.css (validated for colourblind
 * separation). Identity never relies on colour alone: a labelled legend
 * with icons sits above the chart, every column has a hover/tap tooltip,
 * and the same numbers are available as a table.
 */

// Labels come from the dictionary's status words (status.taken etc.).
const SERIES = [
  { key: "taken", color: "var(--color-chart-taken)", Icon: Check },
  { key: "missed", color: "var(--color-chart-missed)", Icon: AlertCircle },
  { key: "skipped", color: "var(--color-chart-skipped)", Icon: Minus },
  { key: "pending", color: "var(--color-chart-upcoming)", Icon: Clock },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];
type Row = DayAdherence & { label: string; top: SeriesKey | null };

// Dates are plain YYYY-MM-DD Indian dates; formatting them as UTC midnight
// keeps the weekday from shifting with the viewer's own timezone.
function toRows(days: DayAdherence[], t: Dictionary, locale: string): Row[] {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return days.map((d, i) => ({
    ...d,
    label: i === days.length - 1 ? t.common.today : weekday.format(new Date(`${d.date}T00:00:00Z`)),
    // Only the topmost non-empty segment gets the rounded data-end.
    top: [...SERIES].reverse().find((s) => d[s.key] > 0)?.key ?? null,
  }));
}

/** A segment: 4px rounded data-end on the top segment only, square elsewhere. */
function segment(key: SeriesKey) {
  return function Segment(props: BarShapeProps) {
    const row = props.payload as Row;
    return <Rectangle {...props} radius={row.top === key ? [4, 4, 0, 0] : 0} />;
  };
}

function ChartTooltip({ active, payload, t, locale }: TooltipContentProps & { t: Dictionary; locale: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Row;
  const fullDate = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <div className="rounded-xl border-2 border-line bg-surface px-4 py-3 text-base shadow-lg">
      <p className="font-bold text-ink">{fullDate.format(new Date(`${row.date}T00:00:00Z`))}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {SERIES.filter((s) => row[s.key] > 0).map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-ink">
            <span aria-hidden="true" className="size-3 rounded-sm" style={{ background: s.color }} />
            {t.status[s.key]}: <span className="font-semibold tabular-nums">{row[s.key]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-ink-muted">
        {row.percent === null ? t.chart.nothingDue : t.chart.percentTaken(row.percent)}
      </p>
    </div>
  );
}

export function AdherenceChart({ days }: { days: DayAdherence[] }) {
  const t = useT();
  const locale = LOCALES[useLanguage()];
  const rows = toRows(days, t, locale);
  const hasData = rows.some((r) => r.taken + r.missed + r.skipped + r.pending > 0);

  return (
    <figure className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-base text-ink" aria-label={t.chart.legend}>
        {SERIES.map(({ key, color, Icon }) => (
          <li key={key} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-4 rounded" style={{ background: color }} />
            <Icon aria-hidden="true" className="size-4 text-ink-muted" />
            {t.status[key]}
          </li>
        ))}
      </ul>

      {hasData ? (
        <div className="h-64 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--color-line)" strokeWidth={1} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--color-line)" }}
                tick={{ fill: "var(--color-ink-muted)", fontSize: 15 }}
                interval={0}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--color-ink-muted)", fontSize: 14 }}
                width={40}
              />
              <Tooltip
                content={(props) => <ChartTooltip {...props} t={t} locale={locale} />}
                cursor={{ fill: "var(--color-surface-muted)" }}
              />
              {SERIES.map(({ key, color }) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="day"
                  fill={color}
                  // The 2px surface-coloured stroke is the gap between
                  // stacked segments, not a border.
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  maxBarSize={24}
                  shape={segment(key)}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-line px-5 py-8 text-center text-lg text-ink-muted">
          {t.chart.empty}
        </p>
      )}

      {/* The same data for screen readers, and for anyone who prefers it. */}
      <details className="text-base">
        <summary className="min-h-touch cursor-pointer py-3 font-semibold text-accent">
          {t.chart.showTable}
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">{t.chart.caption}</caption>
            <thead className="text-ink-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-semibold">{t.chart.day}</th>
                <th scope="col" className="py-2 pr-3 font-semibold">{t.status.taken}</th>
                <th scope="col" className="py-2 pr-3 font-semibold">{t.status.missed}</th>
                <th scope="col" className="py-2 pr-3 font-semibold">{t.status.skipped}</th>
                <th scope="col" className="py-2 pr-3 font-semibold">{t.status.pending}</th>
                <th scope="col" className="py-2 font-semibold">{t.chart.percent}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 font-semibold">{r.label}</th>
                  <td className="py-2 pr-3">{r.taken}</td>
                  <td className={`py-2 pr-3 ${r.missed > 0 ? "font-bold text-danger" : ""}`}>{r.missed}</td>
                  <td className="py-2 pr-3">{r.skipped}</td>
                  <td className="py-2 pr-3">{r.pending}</td>
                  <td className="py-2">{r.percent === null ? "—" : `${r.percent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <figcaption className="sr-only">
        {t.chart.summary}
      </figcaption>
    </figure>
  );
}
