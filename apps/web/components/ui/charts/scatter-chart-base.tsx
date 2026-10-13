"use client";

import * as React from "react";
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

import { chartAxisProps, chartGridProps } from "./chart-axis";

type Series = { key: string; yKey?: string };

type Props = {
  data: object[];
  xKey: string;
  series: Series[];
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
  tooltipContent?: React.ComponentProps<typeof ChartTooltip>["content"];
  showLegend?: boolean;
  yDomain?: [number | string, number | string];
  /** "category" for string x-values (e.g. "Q1 24"); "number" for a true numeric
   * scatter plot. Recharts defaults XAxis to "number", which silently fails to
   * plot string categories — every point renders nowhere. */
  xType?: "category" | "number";
  /** Width reserved for Y-axis tick labels. Recharts' 60px default clips
   * formatted currency labels (e.g. "US$340.00" renders as "S$340.00"). */
  yAxisWidth?: number;
};

export function ScatterChartBase({
  data,
  xKey,
  series,
  config,
  className,
  xFormatter,
  yFormatter,
  tooltipFormatter,
  tooltipValueFormatter,
  tooltipContent,
  showLegend = series.length > 1,
  yDomain,
  xType = "category",
  yAxisWidth = 76,
}: Props) {
  const chartData = React.useMemo(
    () =>
      data.map((row) => ({
        ...row,
        ...Object.fromEntries(
          series.map((item) => [
            item.key,
            (row as Record<string, unknown>)[item.yKey ?? item.key],
          ]),
        ),
      })),
    [data, series],
  );

  return (
    <ChartContainer
      config={config}
      className={cn("h-[320px] md:h-[400px]", className)}
    >
      <ScatterChart accessibilityLayer>
        <CartesianGrid {...chartGridProps} />
        <XAxis
          {...chartAxisProps}
          type={xType}
          dataKey={xKey}
          tickFormatter={(value) => xFormatter?.(value) ?? String(value)}
        />
        <YAxis
          {...chartAxisProps}
          width={yAxisWidth}
          domain={yDomain}
          tickFormatter={(value) =>
            yFormatter?.(Number(value)) ?? String(value)
          }
        />
        <ChartTooltip
          content={
            tooltipContent ?? (
              <ChartTooltipContent
                formatter={tooltipFormatter}
                valueFormatter={tooltipValueFormatter}
                indicator="dot"
              />
            )
          }
        />
        {showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((item) => (
          <Scatter
            key={item.key}
            data={chartData}
            dataKey={item.key}
            name={item.key}
            fill={`var(--color-${item.key})`}
          />
        ))}
      </ScatterChart>
    </ChartContainer>
  );
}
