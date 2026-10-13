"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

import {
  chartAxisProps,
  chartGridProps,
  chartXAxisProps,
  estimateYAxisWidth,
  truncateAxisLabel,
} from "./chart-axis";

/** Chars-per-px estimate used to size a category-axis ellipsis backstop; see
 * `estimateYAxisWidth`'s own comment for where the 7.2 figure comes from. */
const CATEGORY_AXIS_CHAR_WIDTH = 7.2;
/** Cap for a category (text-label) Y-axis — wide enough for most category
 * names without eating too much of the plot area; anything longer is
 * ellipsized via `truncateAxisLabel` rather than left to clip raw (RAD-645). */
const CATEGORY_AXIS_MAX_WIDTH = 160;

type Props<TData extends object = object> = {
  data: TData[];
  xKey: string;
  keys: string[];
  config: ChartConfig;
  className?: string;
  xFormatter?: (value: unknown) => string;
  yFormatter?: (value: number) => string;
  tooltipFormatter?: React.ComponentProps<
    typeof ChartTooltipContent
  >["formatter"];
  tooltipValueFormatter?: React.ComponentProps<
    typeof ChartTooltipContent
  >["valueFormatter"];
  showLegend?: boolean;
  getBarColor?: (row: TData, key: string) => string | undefined;
  barSize?: number;
  radius?: number;
  yDomain?: [number | string, number | string];
  /** Explicit value-axis ticks. Overrides `yDomain`, which is then derived
   * from the first and last tick so the axis ends on a round number. */
  yTicks?: number[];
  /** Width reserved for Y-axis tick labels. Recharts' 60px default clips
   * formatted currency labels (e.g. "US$340.00" renders as "S$340.00"). */
  yAxisWidth?: number;
  /** Recharts bar layout. `vertical` renders horizontal bars (category on Y). */
  layout?: "horizontal" | "vertical";
  /** Disable Recharts entrance animations for users who prefer reduced motion. */
  isAnimationActive?: boolean;
};

export function BarChartBase<TData extends object = object>({
  data,
  xKey,
  keys,
  config,
  className,
  xFormatter,
  yFormatter,
  tooltipFormatter,
  tooltipValueFormatter,
  showLegend = keys.length > 1,
  getBarColor,
  barSize = 16,
  radius = 4,
  yDomain,
  yTicks,
  yAxisWidth,
  layout = "horizontal",
  isAnimationActive = true,
}: Props<TData>) {
  const getColorKey = (key: string) => `__${key}Fill`;
  const chartData = React.useMemo(() => {
    if (!getBarColor) return data;

    return data.map((row) => ({
      ...row,
      ...Object.fromEntries(
        keys.map((key) => [
          getColorKey(key),
          getBarColor(row, key) ?? `var(--color-${key})`,
        ]),
      ),
    }));
  }, [data, getBarColor, keys]);

  const isVertical = layout === "vertical";
  const valueTickProps = yTicks?.length
    ? {
        ticks: yTicks,
        domain: [yTicks[0], yTicks[yTicks.length - 1]] as [number, number],
      }
    : { domain: yDomain };
  // `isVertical` puts categories on the Y-axis (horizontal bars) — the flat
  // 76px gutter sized for short currency ticks left long category names (e.g.
  // "Cafe, Restaurants & Bars") to overflow the SVG's default clip box and
  // lose their leading characters ("Uncategorized" → "ncategorized",
  // RAD-645). Size the gutter from the labels actually being drawn instead,
  // with a wider cap than the currency case since these are free-text names.
  const categoryAxisLabels = isVertical
    ? chartData.map(
        (row) =>
          xFormatter?.((row as Record<string, unknown>)[xKey]) ??
          String((row as Record<string, unknown>)[xKey]),
      )
    : undefined;
  const resolvedYAxisWidth =
    yAxisWidth ??
    (isVertical
      ? estimateYAxisWidth(categoryAxisLabels, 76, CATEGORY_AXIS_MAX_WIDTH)
      : estimateYAxisWidth(
          yTicks?.map((tick) => yFormatter?.(tick) ?? String(tick)),
        ));
  // Even the widened cap can't fit every outlier — ellipsize anything that
  // still wouldn't clear it rather than let Recharts draw the full string and
  // have the SVG clip it raw.
  const categoryAxisMaxChars = Math.max(
    1,
    Math.floor((resolvedYAxisWidth - 16) / CATEGORY_AXIS_CHAR_WIDTH),
  );

  return (
    <ChartContainer
      config={config}
      className={cn("h-[320px] md:h-[400px]", className)}
    >
      <BarChart
        accessibilityLayer
        data={chartData}
        layout={isVertical ? "vertical" : "horizontal"}
      >
        <CartesianGrid {...chartGridProps} />
        {/* Both axes are direct children, and the layout switch lives in their
            props rather than in a wrapper.

            Recharts discovers axes by walking `children` for elements whose
            component type it recognises, and a React fragment is not one of
            them: with these two wrapped in `<>…</>` the chart rendered with no
            axes at all. The cashflow card showed one bare red bar on an empty
            canvas — no month, no amounts, no baseline — and CartesianGrid's
            fallback generator drew the only lines on it (RAD-615). */}
        <XAxis
          {...(isVertical ? chartAxisProps : chartXAxisProps)}
          {...(isVertical
            ? {
                type: "number" as const,
                ...valueTickProps,
                tickFormatter: (value: unknown) =>
                  yFormatter?.(Number(value)) ?? String(value),
              }
            : {
                dataKey: xKey,
                tickFormatter: (value: unknown) =>
                  xFormatter?.(value) ?? String(value),
              })}
        />
        <YAxis
          {...chartAxisProps}
          width={resolvedYAxisWidth}
          {...(isVertical
            ? {
                dataKey: xKey,
                type: "category" as const,
                tickFormatter: (value: unknown) =>
                  truncateAxisLabel(
                    xFormatter?.(value) ?? String(value),
                    categoryAxisMaxChars,
                  ),
              }
            : {
                ...valueTickProps,
                tickFormatter: (value: unknown) =>
                  yFormatter?.(Number(value)) ?? String(value),
              })}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={tooltipFormatter}
              valueFormatter={tooltipValueFormatter}
            />
          }
        />
        {showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {keys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            fill={`var(--color-${key})`}
            radius={radius}
            barSize={barSize}
            isAnimationActive={isAnimationActive}
          >
            {getBarColor
              ? chartData.map((row, index) => (
                  <Cell
                    key={`${key}-${index}`}
                    fill={String(
                      (row as Record<string, unknown>)[getColorKey(key)],
                    )}
                  />
                ))
              : null}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
}
