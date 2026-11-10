import { useMemo } from "react";

import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat } from "@/lib/usePreviewFormat";

// Mock data mirrors the shape of the real product (see NetWorthPreview.tsx) —
// this is a marketing mockup, not the live app. The four figures are
// internally consistent (bank accounts + investments − credit card = net
// worth) so the mosaic reads as one person's finances rather than four
// unrelated demo widgets. The hero shows the net worth card alone.
const HISTORY_POINTS = [46200, 48100, 49800, 51200, 52400, 53630];
const Y_AXIS_MAX = 56000;
const Y_AXIS_MIN = 44000;

// Fixed calendar months (not "today minus 5") so a static build stays
// deterministic — this is sample data, not a live chart.
const HISTORY_MONTHS = [
	new Date(Date.UTC(2026, 2, 1)),
	new Date(Date.UTC(2026, 3, 1)),
	new Date(Date.UTC(2026, 4, 1)),
	new Date(Date.UTC(2026, 5, 1)),
	new Date(Date.UTC(2026, 6, 1)),
	new Date(Date.UTC(2026, 7, 1)),
];

function NetWorthMosaicCard() {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();

	const monthLabels = useMemo(
		() => HISTORY_MONTHS.map((date) => fmt.month(date)),
		[fmt],
	);

	const xStep = 100 / (HISTORY_POINTS.length - 1);
	const yFraction = (value: number) => ((Y_AXIS_MAX - value) / (Y_AXIS_MAX - Y_AXIS_MIN)) * 100;
	const points = HISTORY_POINTS.map((value, i) => ({ x: i * xStep, y: yFraction(value) }));
	const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
	const areaPath = `${linePath} L 100 100 L 0 100 Z`;
	const yTicks = [Y_AXIS_MAX, Y_AXIS_MAX - (Y_AXIS_MAX - Y_AXIS_MIN) / 3, Y_AXIS_MAX - (2 * (Y_AXIS_MAX - Y_AXIS_MIN)) / 3, Y_AXIS_MIN];

	return (
		<div className="rounded-card border border-border bg-card p-6 text-left md:p-8">
			<span className="text-base font-semibold text-foreground">{t("preview.netWorth.title")}</span>
			<div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
				<div>
					<p className="text-xs text-muted-foreground">{t("preview.netWorth.netWorth")}</p>
					<p className="mt-1 font-mono text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{fmt.money(53630)}</p>
					<div className="mt-5 space-y-3">
						<div className="flex items-center justify-between text-sm">
							<span className="text-ink-2">{t("preview.netWorth.assets")}</span>
							<span className="font-mono text-sm font-semibold text-foreground">{fmt.money(54170)}</span>
						</div>
						<ul className="ml-3 space-y-1">
							<li className="flex items-center justify-between text-xs">
								<span className="text-muted-foreground">{t("preview.netWorth.bankAccounts")}</span>
								<span className="font-mono text-ink-2">{fmt.money(22020)}</span>
							</li>
							<li className="flex items-center justify-between text-xs">
								<span className="text-muted-foreground">{t("preview.netWorth.investments")}</span>
								<span className="font-mono text-ink-2">{fmt.money(32150)}</span>
							</li>
						</ul>
						<div className="flex items-center justify-between text-sm">
							<span className="text-ink-2">{t("preview.netWorth.liabilities")}</span>
							<span className="font-mono text-sm font-semibold text-foreground">{fmt.money(-540)}</span>
						</div>
						<ul className="ml-3 space-y-1">
							<li className="flex items-center justify-between text-xs">
								<span className="text-muted-foreground">{t("preview.netWorth.creditCard")}</span>
								<span className="font-mono text-ink-2">{fmt.money(540)}</span>
							</li>
						</ul>
					</div>
				</div>

				<div className="flex flex-col">
					<p className="mb-2 text-xs text-muted-foreground">{t("preview.netWorth.history")}</p>
					<div className="flex h-[240px] flex-col rounded-lg bg-muted p-4 md:h-[300px]">
						<div className="flex min-h-0 flex-1 gap-2.5">
							<div className="flex w-10 flex-none flex-col items-end justify-between pb-px font-mono text-[11px] text-muted-foreground">
								{yTicks.map((tick) => (
									<span key={tick}>{fmt.money(tick, { compact: true })}</span>
								))}
							</div>
							<div className="relative min-w-0 flex-1">
								<svg
									viewBox="0 0 100 100"
									preserveAspectRatio="none"
									className="block h-full w-full overflow-visible"
									role="img"
									aria-label={t("preview.netWorth.chartTrend", {
										start: monthLabels[0],
										end: monthLabels[monthLabels.length - 1],
										from: fmt.money(HISTORY_POINTS[0]),
										to: fmt.money(HISTORY_POINTS[HISTORY_POINTS.length - 1]),
									})}
								>
									<defs>
										<linearGradient id="hero-mosaic-nw-area" x1="0" x2="0" y1="0" y2="1">
											<stop offset="0%" stopColor="oklch(var(--chart-1))" stopOpacity="0.16" />
											<stop offset="100%" stopColor="oklch(var(--chart-1))" stopOpacity="0" />
										</linearGradient>
									</defs>
									<line x1="0" y1="0" x2="100" y2="0" stroke="oklch(var(--border))" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
									<line x1="0" y1="33.33" x2="100" y2="33.33" stroke="oklch(var(--border))" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
									<line x1="0" y1="66.67" x2="100" y2="66.67" stroke="oklch(var(--border))" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
									<line x1="0" y1="100" x2="100" y2="100" stroke="oklch(var(--border))" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
									<path d={areaPath} fill="url(#hero-mosaic-nw-area)" />
									<path d={linePath} fill="none" stroke="oklch(var(--chart-1))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
								</svg>
								<div className="absolute inset-0">
									{points.map((p) => (
										<span
											key={p.x}
											className="absolute h-[7px] w-[7px] rounded-full bg-foreground"
											style={{ left: `${p.x}%`, top: `${p.y}%`, margin: "-3.5px 0 0 -3.5px" }}
										/>
									))}
								</div>
							</div>
						</div>
						<div className="mt-2 flex justify-between pl-[50px] font-mono text-[11px] text-muted-foreground">
							{HISTORY_MONTHS.map((date, i) => (
								<span key={date.getTime()}>{monthLabels[i]}</span>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * The hero's one visual: a single household's net worth, where bank accounts
 * plus investments minus the credit card add up to the headline figure.
 */
export default function HeroMosaic() {
	return <NetWorthMosaicCard />;
}
