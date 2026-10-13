"use client";

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";

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
} from "./chart-axis";

type Series = {
  key: string;
  type?: "line" | "area";
  connectNulls?: boolean;
  strokeWidth?: number;
  showDot?: boolean;
};

type Props = {
  data: object[];
  xKey: string;
  series: Series[];
  config: ChartConfig;
  className?: string;
  yFormatter?: (value: number) => string;
  xFormatter?: (value: unknown) => string;
  xTickCount?: number;
  xTicks?: unknown[];
  yTicks?: number[];
  tooltipFormatter?: React.ComponentProps<
    typeof ChartTooltipContent
  >["formatter"];
  tooltipValueFormatter?: React.ComponentProps<
    typeof ChartTooltipContent
  >["valueFormatter"];
  tooltipContent?: React.ComponentProps<typeof ChartTooltip>["content"];
  showGrid?: boolean;
  showTooltip?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showLegend?: boolean;
  showArea?: boolean;
  yDomain?: [number | string, number | string];
  /** Width reserved for Y-axis tick labels. Recharts' 60px default clips
   * formatted currency labels (e.g. "US$340.00" renders as "S$340.00").
   * Left unset, it is estimated from the labels that will actually be drawn
   * rather than reserving the widest case for every chart. */
  yAxisWidth?: number;
  children?: React.ReactNode;
};

export function AreaLineChartBase({
  data,
  xKey,
  series,
  config,
  className,
  yFormatter,
  xFormatter,
  xTickCount,
  xTicks,
  yTicks,
  tooltipFormatter,
  tooltipValueFormatter,
  tooltipContent,
  showGrid = true,
  showTooltip = true,
  showXAxis = true,
  showYAxis = true,
  showLegend = series.length > 1,
  showArea = true,
  yDomain,
  yAxisWidth,
  children,
}: Props) {
  const gradientPrefix = React.useId().replace(/:/g, "");
  const resolvedYAxisWidth =
    yAxisWidth ??
    estimateYAxisWidth(
      yTicks?.map((tick) => yFormatter?.(tick) ?? String(tick)),
    );
  const getGradientId = (key: string) =>
    `area-line-${gradientPrefix}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <ChartContainer config={config} className={cn("h-[320px]", className)}>
      <ComposedChart accessibilityLayer data={data}>
        <defs>
          {series.map((item) => (
            <linearGradient
              key={item.key}
              id={getGradientId(item.key)}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="5%"
                stopColor={`var(--color-${item.key})`}
                stopOpacity={0.35}
              />
              <stop
                offset="95%"
                stopColor={`var(--color-${item.key})`}
                stopOpacity={0.05}
              />
            </linearGradient>
          ))}
        </defs>
        {showGrid ? <CartesianGrid {...chartGridProps} /> : null}
        {showXAxis ? (
          <XAxis
            {...chartXAxisProps}
            dataKey={xKey}
            tickCount={xTickCount}
            ticks={xTicks as (string | number)[] | undefined}
            tickFormatter={(value) => xFormatter?.(value) ?? String(value)}
          />
        ) : null}
        {showYAxis ? (
          <YAxis
            {...chartAxisProps}
            width={resolvedYAxisWidth}
            domain={yTicks?.length ? [yTicks[0], yTicks[yTicks.length - 1]] : yDomain}
            ticks={yTicks}
            tickFormatter={(value) =>
              yFormatter?.(Number(value)) ?? String(value)
            }
          />
        ) : null}
        {showTooltip ? (
          <ChartTooltip
            content={
              tooltipContent ?? (
                <ChartTooltipContent
                  formatter={tooltipFormatter}
                  valueFormatter={tooltipValueFormatter}
                  indicator="line"
                />
              )
            }
          />
        ) : null}
        {showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((item) =>
          item.type === "area" && showArea ? (
            <Area
              key={item.key}
              dataKey={item.key}
              type="monotone"
              stroke={`var(--color-${item.key})`}
              fill={`url(#${getGradientId(item.key)})`}
              connectNulls={item.connectNulls}
              strokeWidth={item.strokeWidth ?? 2}
              dot={item.showDot ?? false}
            />
          ) : (
            <Line
              key={item.key}
              dataKey={item.key}
              type="monotone"
              stroke={`var(--color-${item.key})`}
              connectNulls={item.connectNulls}
              strokeWidth={item.strokeWidth ?? 2}
              dot={item.showDot ?? false}
            />
          ),
        )}
        {children}
      </ComposedChart>
    </ChartContainer>
  );
}
