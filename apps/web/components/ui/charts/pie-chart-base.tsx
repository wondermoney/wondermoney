"use client";

import * as React from "react";
import { Pie, PieChart } from "recharts";

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
  /** Disable Recharts entrance animations for users who prefer reduced motion. */
  isAnimationActive?: boolean;
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
  isAnimationActive = true,
}: Props) {
  // Each slice's colour rides on its data entry as `fill` (Recharts 3
  // deprecated `<Cell>`; see https://recharts.github.io/en-US/guide/cell/).
  // Recharts reads an entry's `fill` for the sector, its tooltip payload and
  // its legend swatch alike, so all three stay on the category's config
  // colour. The config colour wins over any `fill` already on the entry, as
  // the `<Cell>` it replaces did.
  const coloredData = React.useMemo(
    () =>
      data.map((item, index) => {
        const key = String(
          (item as Record<string, unknown>)[nameKey] ?? index,
        );
        return { ...item, fill: `var(--color-${key})` };
      }),
    [data, nameKey],
  );

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
          data={coloredData}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          isAnimationActive={isAnimationActive}
        />
      </PieChart>
    </ChartContainer>
  );
}
