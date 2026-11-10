"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Amount } from "@/components/ui/Amount";
import CategoryIcon, { categoryIconStyle } from "@/components/ui/CategoryIcon";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import {
  computeSankeyLayout,
  type SankeyData,
  type SankeyNode,
  type SankeyNodeIcon,
  type SankeyNodeKind,
} from "./sankey-layout";

export type SankeyChartProps = {
  data: SankeyData;
  height?: number;
  className?: string;
  locale: string;
  currencyKey: string;
};

const NODE_WIDTH = 20;
// Every label sits beside its node, centred on it (see `nodeLabelPosition`),
// so the padding only has to clear half a line of text above and below.
const NODE_PADDING = 32;
const LABEL_MARGIN = 8;
const CHAR_WIDTH_ESTIMATE = 6;
const MIN_WIDTH = 320;
const MIN_TOUCH_SIZE = 44;
// A label is centred on its node and overhangs into the padding, so even a
// thin node can carry one.
const MIN_LABELED_NODE_HEIGHT = 2;
const ICON_SIZE = 14;
const ICON_GAP = 4;
// The label's halo, shared by the text and the icons drawn beside it.
const HALO_WIDTH = 3;

function truncateLabel(label: string, maxChars: number): string {
  if (maxChars <= 1) return "…";
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(0, maxChars - 1))}…`;
}

type LabelPosition = {
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
  dominantBaseline: "middle" | "hanging";
  maxChars: number;
};

function nodeLabelPosition(node: {
  kind: SankeyNodeKind;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}): LabelPosition {
  const midY = (node.y0 + node.y1) / 2;

  switch (node.kind) {
    case "income":
      return {
        x: node.x1 + LABEL_MARGIN,
        y: midY,
        textAnchor: "start",
        dominantBaseline: "middle",
        maxChars: 0,
      };
    case "account":
      return {
        x: node.x0 - LABEL_MARGIN,
        y: midY,
        textAnchor: "end",
        dominantBaseline: "middle",
        maxChars: 0,
      };
    case "expense":
    default:
      // To the right of the node, on its centre line: below it, the label
      // read as the name of the next node down.
      return {
        x: node.x1 + LABEL_MARGIN,
        y: midY,
        textAnchor: "start",
        dominantBaseline: "middle",
        maxChars: 0,
      };
  }
}

function nodeLabelMaxChars(
  kind: SankeyNodeKind,
  columnWidth: number,
  hasIcon: boolean,
): number {
  const iconWidth = hasIcon ? ICON_SIZE + ICON_GAP : 0;
  switch (kind) {
    case "income":
    case "account":
    case "expense":
    default:
      return Math.max(
        0,
        Math.floor(
          (columnWidth - NODE_WIDTH - LABEL_MARGIN - iconWidth) /
            CHAR_WIDTH_ESTIMATE,
        ),
      );
  }
}

/**
 * A label's icon at `ICON_SIZE`, its top-left corner at the origin. Line
 * icons get the label's halo (a background-coloured copy drawn first, the
 * stroke widened to match the text's), since they sit on the flow bands as
 * often as the text does. A logo is opaque and needs none.
 */
function NodeIconMark({
  icon,
  color,
}: {
  icon: SankeyNodeIcon;
  color: string;
}) {
  const size = `${ICON_SIZE}px`;
  // Lucide draws a 2-unit stroke in a 24-unit box; the halo adds the text
  // halo's width on top of it, scaled into that box.
  const haloStroke = 2 + (HALO_WIDTH * 24) / ICON_SIZE;
  const halo: React.CSSProperties = {
    color: "var(--background)",
    strokeWidth: haloStroke,
  };

  switch (icon.type) {
    case "logo":
      return (
        <image
          href={icon.url}
          width={ICON_SIZE}
          height={ICON_SIZE}
          preserveAspectRatio="xMidYMid meet"
          style={{ clipPath: "inset(0 round 3px)" }}
        />
      );
    case "wallet":
      return (
        <>
          <Wallet width={size} height={size} style={halo} />
          <Wallet
            width={size}
            height={size}
            className="text-muted-foreground"
          />
        </>
      );
    case "category":
    default:
      return (
        <>
          <CategoryIcon
            icon={icon.icon}
            category={icon.icon ? undefined : icon.category}
            width={size}
            height={size}
            style={halo}
          />
          <CategoryIcon
            icon={icon.icon}
            category={icon.icon ? undefined : icon.category}
            width={size}
            height={size}
            // The node's own colour, mixed toward the ink so the pastel
            // category colours clear contrast in both themes.
            style={categoryIconStyle(color)}
          />
        </>
      );
  }
}

/**
 * A node's label with its icon beside it. Income labels read outward from
 * the node (icon, then text) and account labels mirror them, so the icon
 * always sits nearest its node. An expense label is centred under its node,
 * so the icon and text are centred together, which needs the text's
 * rendered width.
 */
function NodeLabel({
  node,
  position,
  text,
}: {
  node: SankeyNode & { color: string };
  position: LabelPosition;
  text: string;
}) {
  const textRef = React.useRef<SVGTextElement>(null);
  const [textWidth, setTextWidth] = React.useState<number | null>(null);
  const icon = node.icon;
  const centered = position.textAnchor === "middle";

  React.useLayoutEffect(() => {
    if (!icon || !centered || !textRef.current) return;
    setTextWidth(textRef.current.getComputedTextLength());
  }, [icon, centered, text]);

  const iconWidth = icon ? ICON_SIZE + ICON_GAP : 0;
  let textX = position.x;
  let iconX = position.x;
  if (position.textAnchor === "start") {
    textX = position.x + iconWidth;
  } else if (position.textAnchor === "end") {
    textX = position.x - iconWidth;
    iconX = position.x - ICON_SIZE;
  } else {
    textX = position.x + iconWidth / 2;
    iconX = position.x - ((textWidth ?? 0) + iconWidth) / 2;
  }
  // Centred on the text line: a middle baseline sits on the line's centre;
  // a hanging one sits at the top of the 11px glyphs, about 5px above it.
  const iconY =
    position.dominantBaseline === "middle"
      ? position.y - ICON_SIZE / 2
      : position.y + 5 - ICON_SIZE / 2;

  return (
    <>
      {icon && (!centered || textWidth !== null) ? (
        <g
          transform={`translate(${iconX} ${iconY})`}
          style={{ pointerEvents: "none" }}
          aria-hidden="true"
        >
          <NodeIconMark icon={icon} color={node.color} />
        </g>
      ) : null}
      <text
        ref={textRef}
        x={textX}
        y={position.y}
        textAnchor={position.textAnchor}
        dominantBaseline={position.dominantBaseline}
        // Foreground, not muted: these labels sit on coloured
        // flow bands as often as on the canvas, and muted ink
        // fell under 4.5:1 on the pale bands (Gifts on lime).
        className="fill-foreground font-sans text-[11px]"
        // Labels can sit over a link's colored flow band, not
        // just the canvas — a plain muted-foreground fill
        // disappears against a similarly light/dark band. A
        // background-color stroke behind the glyphs
        // (paintOrder puts the stroke under the fill) reads as
        // a halo instead of an outline.
        style={{
          pointerEvents: "none",
          paintOrder: "stroke",
          stroke: "var(--background)",
          strokeWidth: HALO_WIDTH,
          strokeLinejoin: "round",
        }}
      >
        {text}
      </text>
    </>
  );
}

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = React.useState(MIN_WIDTH);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      setWidth(Math.max(MIN_WIDTH, rect.width));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function renderLinkTooltip(
  t: (key: string, values?: Record<string, string>) => string,
  source: SankeyNode,
  target: SankeyNode,
  value: number,
  formatValue: (value: number) => string,
): string {
  return t("linkTooltip", {
    source: source.label,
    target: target.label,
    value: formatValue(value),
  });
}

function renderNodeTooltip(
  t: (key: string, values?: Record<string, string>) => string,
  node: SankeyNode,
  value: number,
  formatValue: (value: number) => string,
): string {
  return t("nodeTooltip", {
    label: node.label,
    value: formatValue(value),
  });
}

export function SankeyChart({
  data,
  height = 360,
  className,
  currencyKey,
}: SankeyChartProps) {
  const t = useTranslations("reports.reports.sankey");
  const formatMoney = useFormatCurrency();
  const formatValue = (value: number) => formatMoney(value, currencyKey);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);
  const [hoveredLinkIndex, setHoveredLinkIndex] = React.useState<number | null>(
    null,
  );
  const [tooltip, setTooltip] = React.useState<{
    x: number;
    y: number;
    content: string;
  } | null>(null);

  const layout = React.useMemo(
    () =>
      computeSankeyLayout(data, {
        width,
        height,
        nodeWidth: NODE_WIDTH,
        nodePadding: NODE_PADDING,
      }),
    [data, width, height],
  );

  const columnWidth = width / layout.columns;

  const handleLinkEnter = (
    event: React.MouseEvent,
    index: number,
    source: SankeyNode,
    target: SankeyNode,
    value: number,
  ) => {
    setHoveredLinkIndex(index);
    setTooltip({
      x: event.clientX,
      y: event.clientY,
      content: renderLinkTooltip(t, source, target, value, formatValue),
    });
  };

  const handleNodeEnter = (
    event: React.MouseEvent,
    node: SankeyNode,
    value: number,
  ) => {
    setHoveredNodeId(node.id);
    setTooltip({
      x: event.clientX,
      y: event.clientY,
      content: renderNodeTooltip(t, node, value, formatValue),
    });
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    setTooltip((prev) =>
      prev ? { ...prev, x: event.clientX, y: event.clientY } : null,
    );
  };

  const handleLeave = () => {
    setHoveredNodeId(null);
    setHoveredLinkIndex(null);
    setTooltip(null);
  };

  const nodeTotalValues = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const node of data.nodes) {
      map.set(node.id, node.value ?? 0);
    }
    return map;
  }, [data.nodes]);

  const sortedNodes = React.useMemo(() => {
    return [...layout.nodes].sort((a, b) => {
      const columnDiff = a.x0 - b.x0;
      if (columnDiff !== 0) return columnDiff;
      return a.y0 - b.y0;
    });
  }, [layout.nodes]);

  const sortedLinks = React.useMemo(() => {
    return [...layout.links]
      .map((link, index) => ({ link, index }))
      .sort((a, b) => {
        const columnDiff = a.link.source.x0 - b.link.source.x0;
        if (columnDiff !== 0) return columnDiff;
        return a.link.source.y0 - b.link.source.y0;
      });
  }, [layout.links]);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Chart view */}
      <div className="hidden sm:block">
        <svg
          role="img"
          aria-label={t("ariaLabel", {
            total: formatValue(layout.totalValue),
          })}
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleLeave}
        >
          {/* Links */}
          <g>
            {sortedLinks.map(({ link, index }) => {
              const isHovered = hoveredLinkIndex === index;
              const isConnected =
                hoveredNodeId === link.source.id ||
                hoveredNodeId === link.target.id;
              const isDimmed =
                hoveredLinkIndex !== null
                  ? !isHovered
                  : hoveredNodeId !== null
                    ? !isConnected
                    : false;

              return (
                <g key={`link-${index}`}>
                  <path
                    d={link.path}
                    fill="none"
                    // One flat tint of the source colour. The band used to
                    // fade along a 0.9 to 0.15 gradient, a gradient in a data
                    // mark that made equal flows look unequal by position.
                    stroke={link.source.color}
                    strokeWidth={link.width}
                    strokeOpacity={isDimmed ? 0.12 : 0.45}
                    // A focused band turns the ring violet; the outline would
                    // only draw the band's bounding box.
                    className="focus-visible:stroke-ring focus-visible:outline-none motion-safe:transition-opacity motion-safe:duration-100 motion-safe:ease-out motion-reduce:transition-none"
                    tabIndex={0}
                    onMouseEnter={(event) =>
                      handleLinkEnter(
                        event,
                        index,
                        link.source,
                        link.target,
                        link.value,
                      )
                    }
                    onMouseLeave={handleLeave}
                    onFocus={() => setHoveredLinkIndex(index)}
                    onBlur={() => setHoveredLinkIndex(null)}
                    style={{ cursor: "pointer" }}
                  />
                  {/* Wider invisible hit area for touch/accessibility */}
                  <path
                    d={link.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(44, link.width)}
                    tabIndex={-1}
                    onMouseEnter={(event) =>
                      handleLinkEnter(
                        event,
                        index,
                        link.source,
                        link.target,
                        link.value,
                      )
                    }
                    onMouseLeave={handleLeave}
                    style={{ cursor: "pointer" }}
                  />
                  <title>
                    {renderLinkTooltip(
                      t,
                      link.source,
                      link.target,
                      link.value,
                      formatValue,
                    )}
                  </title>
                </g>
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {sortedNodes.map((node) => {
              const label = nodeLabelPosition(node);
              const maxChars = nodeLabelMaxChars(
                node.kind,
                columnWidth,
                node.icon !== undefined,
              );
              const displayLabel = truncateLabel(node.label, maxChars);
              const isHovered = hoveredNodeId === node.id;
              const isConnected = layout.links.some(
                (link) =>
                  link.source.id === node.id || link.target.id === node.id,
              );
              const isDimmed =
                hoveredLinkIndex !== null
                  ? !isConnected
                  : hoveredNodeId !== null
                    ? !isHovered
                    : false;

              return (
                <g key={`node-${node.id}`}>
                  {/* Invisible touch target (minimum 44px) */}
                  <rect
                    x={node.x0 - (MIN_TOUCH_SIZE - (node.x1 - node.x0)) / 2}
                    y={node.y0 - (MIN_TOUCH_SIZE - (node.y1 - node.y0)) / 2}
                    width={Math.max(MIN_TOUCH_SIZE, node.x1 - node.x0)}
                    height={Math.max(MIN_TOUCH_SIZE, node.y1 - node.y0)}
                    rx={4}
                    fill="transparent"
                    tabIndex={0}
                    className="focus-visible:stroke-ring focus-visible:stroke-2"
                    onMouseEnter={(event) =>
                      handleNodeEnter(
                        event,
                        node,
                        nodeTotalValues.get(node.id) ?? 0,
                      )
                    }
                    onMouseLeave={handleLeave}
                    onFocus={() => setHoveredNodeId(node.id)}
                    onBlur={() => setHoveredNodeId(null)}
                    style={{ cursor: "pointer" }}
                  />
                  <rect
                    x={node.x0}
                    y={node.y0}
                    width={node.x1 - node.x0}
                    height={node.y1 - node.y0}
                    rx={4}
                    fill={node.color}
                    fillOpacity={isDimmed ? 0.3 : 1}
                    className="pointer-events-none motion-safe:transition-opacity motion-safe:duration-100 motion-safe:ease-out motion-reduce:transition-none"
                    style={{ cursor: "pointer" }}
                  />
                  <title>
                    {renderNodeTooltip(
                      t,
                      node,
                      nodeTotalValues.get(node.id) ?? 0,
                      formatValue,
                    )}
                  </title>
                  {/* A category's node height is proportional to its flow
                      value, so a small-spend category (a few € against a
                      total in the thousands) can get a rect just a few px
                      tall — far shorter than the 11px label wants to sit
                      beside without colliding with the next node up or down.
                      Below that floor, drop the label; the value is still
                      reachable via the tooltip on hover/focus and via the
                      "Spending by category" list beside this chart. */}
                  {node.y1 - node.y0 >= MIN_LABELED_NODE_HEIGHT ? (
                    <NodeLabel
                      node={node}
                      position={label}
                      text={displayLabel}
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip && (
          <div
            className="bg-popover border-border pointer-events-none fixed z-50 rounded-lg border px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y - 12,
            }}
          >
            <span className="text-foreground">{tooltip.content}</span>
          </div>
        )}
      </div>

      {/* Mobile fallback */}
      <div className="block sm:hidden">
        <p className="text-muted-foreground text-sm">{t("mobileNotice")}</p>
        {/* No border of its own: the table already sits inside the report
            card, and a bordered box inside it was a card in a card. */}
        <div className="mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                  {t("mobileTableSource")}
                </th>
                <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                  {t("mobileTableTarget")}
                </th>
                <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                  {t("mobileTableValue")}
                </th>
              </tr>
            </thead>
            <tbody>
              {layout.links.map((link, index) => (
                <tr key={`mobile-link-${index}`} className="border-t">
                  <td className="px-3 py-2">{link.source.label}</td>
                  <td className="px-3 py-2">{link.target.label}</td>
                  <td className="px-3 py-2 text-right">
                    {/* The SVG labels above must be strings, so this file keeps a
                        local string formatter. This is real DOM, though, so the
                        currency can recede here as it does everywhere else. */}
                    <Amount value={link.value} currency={currencyKey} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

SankeyChart.displayName = "SankeyChart";
