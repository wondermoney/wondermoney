export const chartAxisProps = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
} as const;

/**
 * X-axis defaults. Recharts' `minTickGap` is 5px, which on a year of daily
 * closes printed two dozen dates across the axis — a wall of text (RAD-612).
 * A gap wide enough for a formatted date makes the tick count fall out of the
 * available width instead of out of the number of points, so the same chart
 * thins itself on a phone without any breakpoint logic.
 */
export const chartXAxisProps = {
  ...chartAxisProps,
  minTickGap: 56,
  interval: "preserveStartEnd",
} as const;

export const chartGridProps = {
  vertical: false,
} as const;

/**
 * Evenly spaced ticks on rounded values covering [min, max].
 *
 * Recharts' own domain ends at the data's extremes, so a price series produced
 * ticks like 239.15 / 269.15 / 299.15 / 347.56 — three even steps and then a
 * jump, which cannot be read at a glance (RAD-611, RAD-613). This picks a step
 * from the 1 / 2 / 2.5 / 5 / 10 family and lands every tick on a multiple of
 * it.
 */
export function niceTicks(
  min: number,
  max: number,
  targetCount = 5,
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (targetCount < 2) targetCount = 2;

  if (min === max) {
    // A flat series still needs a window with height around it.
    const magnitude = Math.abs(min) || 1;
    min -= magnitude * 0.05;
    max += magnitude * 0.05;
  }

  const step = niceStep((max - min) / (targetCount - 1));
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // Accumulating with multiplication rather than repeated addition keeps
  // floating-point drift from turning 0.3 into 0.30000000000000004.
  for (let index = 0; start + index * step <= end + step / 1e6; index += 1) {
    ticks.push(roundToStep(start + index * step, step));
    if (ticks.length > 100) break;
  }

  return ticks;
}

function niceStep(rawStep: number): number {
  if (rawStep <= 0 || !Number.isFinite(rawStep)) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;

  const multiplier =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;

  return multiplier * magnitude;
}

function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return Number(value.toFixed(Math.min(decimals, 12)));
}

/**
 * Width to reserve for the Y-axis gutter, estimated from the labels that will
 * actually be drawn.
 *
 * The flat 76px default was picked so a long currency label ("US$340.00") would
 * not be clipped, and then charged to every chart — the net worth chart reserved
 * it for labels half that wide and pushed its plot area far to the right
 * (RAD-613). Recharts gives us no measured text width, so this estimates from
 * the tick font (12px) and clamps to a sane band.
 *
 * `maxWidth` defaults to the original 96px currency-label cap; a category axis
 * (long free-text names, e.g. "Cafe, Restaurants & Bars") passes a wider one —
 * see `truncateAxisLabel` for the ellipsis backstop once even that cap isn't
 * enough (RAD-645).
 */
export function estimateYAxisWidth(
  labels: string[] | undefined,
  fallback = 76,
  maxWidth = 96,
): number {
  if (!labels?.length) return fallback;

  const widest = Math.max(...labels.map((label) => label.length));
  return Math.min(maxWidth, Math.max(40, Math.ceil(widest * 7.2) + 16));
}

/**
 * Truncates a tick label to fit `maxChars`, ellipsizing the tail rather than
 * letting Recharts draw the full string and have it clipped raw by the SVG's
 * default `overflow: hidden` — the failure mode that turned "Uncategorized"
 * into "ncategorized" and "CAFE_RESTAURANTS_BARS" into "ANTS_BARS" on a narrow
 * category axis (RAD-645). Mirrors the Sankey chart's own `truncateLabel`.
 */
export function truncateAxisLabel(label: string, maxChars: number): string {
  if (maxChars <= 1) return "…";
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * The subset of a date series worth labelling: month starts over long spans,
 * week starts over medium ones, and every point over short ones — then thinned
 * evenly so the axis never exceeds `maxTicks`.
 *
 * The values returned are members of `dates`, because a category axis can only
 * place a tick on a value it actually has.
 */
export function pickDateAxisTicks(dates: string[], maxTicks = 8): string[] {
  if (dates.length <= 2) return [...dates];

  const ordered = [...dates].sort((a, b) => a.localeCompare(b));
  const spanInDays = differenceInDays(ordered[0], ordered[ordered.length - 1]);

  const candidates =
    spanInDays > 120
      ? firstOfEach(ordered, (date) => date.slice(0, 7))
      : spanInDays > 45
        ? firstOfEach(ordered, isoWeekKey)
        : ordered;

  return thinEvenly(candidates.length >= 2 ? candidates : ordered, maxTicks);
}

function differenceInDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function firstOfEach(dates: string[], keyOf: (date: string) => string): string[] {
  const seen = new Set<string>();
  return dates.filter((date) => {
    const key = keyOf(date);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isoWeekKey(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  // Monday-based week bucket; the exact epoch offset does not matter as long as
  // it is stable, since the key is only used to group.
  const week = Math.floor((parsed.getTime() / 86_400_000 + 3) / 7);
  return String(week);
}

function thinEvenly(values: string[], maxTicks: number): string[] {
  if (maxTicks < 2 || values.length <= maxTicks) return values;

  const step = (values.length - 1) / (maxTicks - 1);
  const picked = new Set<string>();
  for (let index = 0; index < maxTicks; index += 1) {
    picked.add(values[Math.round(index * step)]);
  }

  return values.filter((value) => picked.has(value));
}
