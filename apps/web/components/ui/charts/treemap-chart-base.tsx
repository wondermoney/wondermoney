"use client";

import * as React from "react";
import { Treemap, type TreemapNode } from "recharts";

import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/**
 * One treemap tile. The report supplies the colour, the label and the accessible name; this
 * component owns the layout, the focus/keyboard contract and the responsive container.
 */
export interface TreemapTileDatum {
  /** The accessible name, including the figures a sighted reader gets from the label. */
  ariaLabel: string;
  /** A second line inside the tile, e.g. the change from normal. */
  detail?: string;
  /** A dashed outline marks a tile with no baseline, without relying on colour. */
  dashed?: boolean;
  fill: string;
  name: string;
  /** Tailwind text colour paired with `fill`. */
  textClassName?: string;
  value: number;
  /** Recharts spreads the datum onto the node; the report carries its own keys through it. */
  [key: string]: unknown;
}

interface TreemapChartBaseProps<T extends TreemapTileDatum> {
  config: ChartConfig;
  data: T[];
  className?: string;
  isAnimationActive?: boolean;
  /** Called on click, Enter or Space: the report navigates to the tile's rows. */
  onActivate?: (tile: T) => void;
  /** Called when a tile gains or loses hover/focus. */
  onHoverChange?: (tile: T | null) => void;
}

const MIN_LABEL_WIDTH = 64;
const MIN_LABEL_HEIGHT = 26;
const MIN_DETAIL_HEIGHT = 44;
/** Geist's average glyph width at 12px, for a cheap truncation estimate. */
const CHAR_WIDTH = 6.8;

/**
 * A flat treemap whose tiles are keyboard-focusable links. The report always renders an
 * equivalent table, so the tiles are an enhancement: every figure and every destination is also
 * reachable without the chart.
 */
export function TreemapChartBase<T extends TreemapTileDatum>({
  config,
  data,
  className,
  isAnimationActive = true,
  onActivate,
  onHoverChange,
}: TreemapChartBaseProps<T>) {
  const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null);

  const renderTile = React.useCallback(
    (node: TreemapNode) => {
      // The root covers the whole chart; only the leaves are tiles.
      if (node.depth === 0) return <g />;
      const tile = node as TreemapNode & T;
      const { height, index, width, x, y } = node;
      const showName = width >= MIN_LABEL_WIDTH && height >= MIN_LABEL_HEIGHT;
      const showDetail =
        tile.detail !== undefined &&
        width >= MIN_LABEL_WIDTH &&
        height >= MIN_DETAIL_HEIGHT;
      const maxCharacters = Math.max(1, Math.floor((width - 16) / CHAR_WIDTH));

      return (
        <g
          aria-label={tile.ariaLabel}
          className="cursor-pointer outline-none"
          onClick={() => onActivate?.(tile)}
          onFocus={() => {
            setFocusedIndex(index);
            onHoverChange?.(tile);
          }}
          onBlur={() => {
            setFocusedIndex(null);
            onHoverChange?.(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onActivate?.(tile);
          }}
          onMouseEnter={() => onHoverChange?.(tile)}
          onMouseLeave={() => {
            // A focused tile keeps the panel: the pointer leaving must not clear what the
            // keyboard reader is looking at.
            if (focusedIndex !== index) onHoverChange?.(null);
          }}
          role="link"
          tabIndex={0}
        >
          <rect
            fill={tile.fill}
            height={height}
            rx={4}
            stroke={tile.dashed ? "var(--muted-foreground)" : "var(--card)"}
            strokeDasharray={tile.dashed ? "4 3" : undefined}
            strokeWidth={2}
            width={width}
            x={x}
            y={y}
          />
          {focusedIndex === index ? (
            <rect
              fill="none"
              height={Math.max(0, height - 2)}
              rx={4}
              stroke="var(--ring)"
              strokeWidth={3}
              width={Math.max(0, width - 2)}
              x={x + 1}
              y={y + 1}
            />
          ) : null}
          {showName ? (
            <text
              className={cn("fill-current text-xs font-medium", tile.textClassName)}
              x={x + 8}
              y={y + 17}
            >
              {truncate(tile.name, maxCharacters)}
            </text>
          ) : null}
          {showDetail ? (
            <text
              className={cn("fill-current font-mono text-xs", tile.textClassName)}
              x={x + 8}
              y={y + 33}
            >
              {truncate(tile.detail ?? "", maxCharacters)}
            </text>
          ) : null}
        </g>
      );
    },
    [focusedIndex, onActivate, onHoverChange],
  );

  return (
    <ChartContainer
      className={cn("h-[320px] md:h-[420px]", className)}
      config={config}
    >
      <Treemap
        aspectRatio={4 / 3}
        content={renderTile}
        data={data}
        dataKey="value"
        isAnimationActive={isAnimationActive}
        nameKey="name"
        nodeGap={2}
        type="flat"
      />
    </ChartContainer>
  );
}

function truncate(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  if (maxCharacters <= 1) return "…";
  return `${value.slice(0, maxCharacters - 1)}…`;
}
