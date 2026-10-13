"use client";

import * as React from "react";
import {
  Area,
  Bar,
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

import { chartAxisProps, chartGridProps } from "./chart-axis";

type Props = {
  data: object[];
  xKey: string;
  areaKeys: string[];
  barKeys: string[];
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
  tooltipLabelFormatter?: React.ComponentProps<
    typeof ChartTooltipContent
  >["labelFormatter"];
  barSize?: number;
  radius?: number;
  /** Optional line series rendered on top of the area and bar layers. */
  lineKeys?: string[];
  /** Disable Recharts entrance animations for users who prefer reduced motion. */
  isAnimationActive?: boolean;
  /**
   * Bridge a `null` in a series instead of leaving a gap. Off by default: a gap
   * is how the chart says "no data", and joining across one asserts a trend
   * through a month nobody measured.
   */
  connectNulls?: boolean;
  /**
   * Name of a boolean field on each row marking that point as provisional — a
   * period still running, or one the range only partly covers. Those points get
   * an open marker on the line series so the reader can see the figure is not
   * final. Always pair it with a written note; a marker alone is not a cue.
   */
  provisionalKey?: string;
};

type ProvisionalDotProps = {
  cx?: number;
  cy?: number;
  index?: number;
  stroke?: string;
  payload?: Record<string, unknown>;
};

/**
 * Open marker (surface-filled, stroked in the series colour) on provisional
 * points only; every other point renders nothing, keeping the dotless line the
 * rest of the system uses.
 */
function renderProvisionalDot(provisionalKey: string) {
  return function ProvisionalDot({
    cx,
    cy,
    index,
    stroke,
    payload,
  }: ProvisionalDotProps): React.ReactElement<SVGElement> {
    const key = `provisional-dot-${index ?? 0}`;
    if (cx == null || cy == null || !payload?.[provisionalKey]) {
      return <g key={key} />;
    }

    return (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={4}
        fill="var(--background)"
        stroke={stroke}
        strokeWidth={2}
      />
    );
  };
}

export function ComposedAreaBarChartBase({
  data,
  xKey,
  areaKeys,
  barKeys,
  config,
  className,
  xFormatter,
  yFormatter,
  tooltipFormatter,
  tooltipValueFormatter,
  tooltipLabelFormatter,
  barSize = 4,
  radius = 4,
  lineKeys = [],
  isAnimationActive = true,
  connectNulls = false,
  provisionalKey,
}: Props) {
  const gradientPrefix = React.useId().replace(/:/g, "");
  const lineDot = provisionalKey
    ? renderProvisionalDot(provisionalKey)
    : (false as const);
  const getGradientId = (key: string) =>
    `area-bar-${gradientPrefix}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <ChartContainer
      config={config}
      className={cn("h-[320px] md:h-[400px]", className)}
    >
      <ComposedChart accessibilityLayer data={data}>
        <defs>
          {areaKeys.map((key) => (
            <linearGradient
              key={key}
              id={getGradientId(key)}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="5%"
                stopColor={`var(--color-${key})`}
                stopOpacity={0.35}
              />
              <stop
                offset="95%"
                stopColor={`var(--color-${key})`}
                stopOpacity={0.05}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...chartGridProps} />
        <XAxis
          {...chartAxisProps}
          dataKey={xKey}
          tickFormatter={(value) => xFormatter?.(value) ?? String(value)}
        />
        <YAxis
          {...chartAxisProps}
          tickFormatter={(value) =>
            yFormatter?.(Number(value)) ?? String(value)
          }
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={tooltipFormatter}
              valueFormatter={tooltipValueFormatter}
              labelFormatter={tooltipLabelFormatter}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {areaKeys.map((key) => (
          <Area
            key={key}
            dataKey={key}
            type="monotone"
            fill={`url(#${getGradientId(key)})`}
            stroke={`var(--color-${key})`}
            connectNulls={connectNulls}
            isAnimationActive={isAnimationActive}
          />
        ))}
        {barKeys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            fill={`var(--color-${key})`}
            radius={radius}
            barSize={barSize}
            isAnimationActive={isAnimationActive}
          />
        ))}
        {lineKeys.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={lineDot}
            connectNulls={connectNulls}
            isAnimationActive={isAnimationActive}
          />
        ))}
      </ComposedChart>
    </ChartContainer>
  );
}
