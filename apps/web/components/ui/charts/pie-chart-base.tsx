"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

type Props = {
  data: object[];
  config: ChartConfig;
  nameKey?: string;
  valueKey?: string;
  className?: string;
  showLegend?: boolean;
  tooltipFormatter?: React.ComponentProps<
    typeof ChartTooltipContent
  >["formatter"];
  innerRadius?: number;
  outerRadius?: number;
};

export function PieChartBase({
  data,
  config,
  nameKey = "name",
  valueKey = "value",
  className,
  showLegend = true,
  tooltipFormatter,
  innerRadius = 58,
  outerRadius = 92,
}: Props) {
  return (
    <ChartContainer
      config={config}
      className={cn("mx-auto h-[280px] md:h-[320px]", className)}
    >
      <PieChart accessibilityLayer>
        <ChartTooltip
          content={<ChartTooltipContent formatter={tooltipFormatter} />}
        />
        {showLegend ? (
          <ChartLegend content={<ChartLegendContent nameKey={nameKey} />} />
        ) : null}
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
        >
          {data.map((item, index) => {
            const key = String(
              (item as Record<string, unknown>)[nameKey] ?? index,
            );

            return <Cell key={key} fill={`var(--color-${key})`} />;
          })}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
