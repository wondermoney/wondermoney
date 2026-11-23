import { TrendingDown, TrendingUp } from "lucide-react";
import { useId } from "react";

import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat, type PreviewFormat } from "@/lib/usePreviewFormat";

import {
	plotPoints,
	rowChange,
	smoothPath,
	summarize,
	tickY,
	type Change,
	type NetWorthRow,
	type NetWorthSample,
} from "./netWorthSample";

// A marketing mockup of the app's net worth summary, not the real product: the figures come from
// `netWorthSample.ts`, where they reconcile. The homepage hero and the net worth feature page
// both draw this card, each with its own household.

/** Gains in the success token, losses in the destructive one; the sign always stays. */
const toneClass = (change: Change) =>
	change.delta === 0 ? "text-muted-foreground" : change.improves ? "text-success-text" : "text-destructive-text";

function ChangeBadge({ change, fmt }: { change: Change; fmt: PreviewFormat }) {
	const Icon = change.delta < 0 ? TrendingDown : TrendingUp;
	const tint = change.improves ? "bg-success/10" : "bg-destructive/10";
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums ${tint} ${toneClass(change)}`}
		>
			<Icon aria-hidden="true" className="size-3.5" strokeWidth={2} />
			{fmt.pct(change.percent, { sign: "always" })}
		</span>
	);
}

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_3.5rem_4.75rem] items-baseline gap-x-2";

function Rows({ rows, fmt }: { rows: NetWorthRow[]; fmt: PreviewFormat }) {
	const { t } = useTranslations();
	return (
		<ul className="ml-3 space-y-1.5">
			{rows.map((row) => {
				const change = rowChange(row);
				return (
					<li key={row.labelKey} className={`${ROW_GRID} text-xs`}>
						<span className="truncate text-muted-foreground">{t(row.labelKey)}</span>
						<span className={`text-right font-mono text-[11px] tabular-nums ${toneClass(change)}`}>
							{fmt.pct(change.percent, { sign: "always" })}
						</span>
						<span className="text-right font-mono tabular-nums text-ink-2">{fmt.money(row.end)}</span>
					</li>
				);
			})}
		</ul>
	);
}

function HistoryChart({ sample, fmt }: { sample: NetWorthSample; fmt: PreviewFormat }) {
	const { t } = useTranslations();
	const gradientId = `${useId()}-net-worth-area`;
	const points = plotPoints(sample);
	const linePath = smoothPath(points);
	const areaPath = `${linePath} L 100 100 L 0 100 Z`;
	const latest = points[points.length - 1];
	const months = sample.months.map((month) => fmt.month(month));
	const lowTick = sample.yTicks[0];

	return (
		<figure className="flex min-w-0 flex-col @xl:h-full">
			<figcaption className="mb-6 text-xs text-muted-foreground">{t("preview.netWorth.history")}</figcaption>
			<div className="relative h-44 @xl:h-auto @xl:min-h-44 @xl:flex-1">
				{/* Tick labels sit over their gridlines at the left, where a rising line leaves room. */}
				{sample.yTicks.map((tick) => (
					<span
						key={tick}
						className="absolute left-0 -translate-y-full pb-0.5 font-mono text-[10px] leading-none text-muted-foreground tabular-nums"
						style={{ top: `${tickY(sample, tick)}%` }}
					>
						{fmt.money(tick, { compact: true })}
					</span>
				))}
				<svg
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					className="absolute inset-0 block h-full w-full overflow-visible"
					role="img"
					aria-label={t("preview.netWorth.chartTrend", {
						start: months[0],
						end: months[months.length - 1],
						from: fmt.money(sample.history[0]),
						to: fmt.money(sample.history[sample.history.length - 1]),
					})}
				>
					<defs>
						<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stopColor="oklch(var(--chart-1))" stopOpacity="0.14" />
							<stop offset="100%" stopColor="oklch(var(--chart-1))" stopOpacity="0" />
						</linearGradient>
					</defs>
					{sample.yTicks.map((tick) => (
						<line
							key={tick}
							x1="0"
							x2="100"
							y1={tickY(sample, tick)}
							y2={tickY(sample, tick)}
							stroke={tick === lowTick ? "oklch(var(--border))" : "oklch(var(--border-2))"}
							strokeWidth="1"
							vectorEffect="non-scaling-stroke"
						/>
					))}
					<path d={areaPath} fill={`url(#${gradientId})`} />
					<path
						d={linePath}
						fill="none"
						stroke="oklch(var(--chart-1))"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
				{/* The latest month only, drawn in HTML so it stays round when the SVG stretches. */}
				<span
					data-testid="net-worth-latest-point"
					aria-hidden="true"
					className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-[3px] ring-card"
					style={{ left: `${latest.x}%`, top: `${latest.y}%` }}
				/>
			</div>
			<div aria-hidden="true" className="relative mt-2 h-4 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
				{months.map((month, i) => (
					<span
						key={sample.months[i].getTime()}
						className="absolute top-0 -translate-x-1/2"
						style={{ left: `${points[i].x}%` }}
					>
						{month}
					</span>
				))}
			</div>
		</figure>
	);
}

export default function NetWorthPreview({ sample }: { sample: NetWorthSample }) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const { assets, liabilities, netWorth, change } = summarize(sample);
	const assetRows = sample.rows.filter((row) => row.kind === "asset");
	const liabilityRows = sample.rows.filter((row) => row.kind === "liability");

	return (
		<div className="@container rounded-card border border-border bg-card p-6 text-left md:p-8">
			<div className="flex items-center justify-between gap-3">
				<span className="text-base font-semibold text-foreground">{t("preview.netWorth.title")}</span>
				<span className="rounded-sm border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
					{t("preview.netWorth.historyPeriod")}
				</span>
			</div>

			<div className="mt-6 grid grid-cols-1 gap-8 @xl:grid-cols-2">
				<div>
					<p className="text-xs text-muted-foreground">{t("preview.netWorth.netWorth")}</p>
					<p className="mt-1 font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums md:text-4xl">
						{fmt.money(netWorth)}
					</p>
					<p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="sr-only">{t("preview.netWorth.changeLabel")}:</span>
						<ChangeBadge change={change} fmt={fmt} />
						<span className={`font-mono text-sm tabular-nums ${toneClass(change)}`}>
							{fmt.money(change.delta, { sign: "always" })}
						</span>
					</p>

					<div className="mt-6 space-y-3">
						<div className="flex items-center justify-between text-sm">
							<span className="text-ink-2">{t("preview.netWorth.assets")}</span>
							<span className="font-mono font-semibold text-foreground tabular-nums">{fmt.money(assets)}</span>
						</div>
						<Rows rows={assetRows} fmt={fmt} />
						<div className="flex items-center justify-between text-sm">
							<span className="text-ink-2">{t("preview.netWorth.liabilities")}</span>
							<span className="font-mono font-semibold text-foreground tabular-nums">{fmt.money(-liabilities)}</span>
						</div>
						<Rows rows={liabilityRows} fmt={fmt} />
					</div>
				</div>

				<HistoryChart sample={sample} fmt={fmt} />
			</div>
		</div>
	);
}
